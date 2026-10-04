import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { GroveApi } from '../api/contracts';
import { demoUtterances } from '../api/fixtures';
import type { Seed } from '../types';
import { browserEnvironment, checkTabCaptureSupport, type AudioChannel } from './capture';
import { startOnlineCapture, type OnlineCapture, type SessionEndReason } from './online';
import {
  createTranscriptSession, UNKNOWN_SPEAKER, type TranscriptSession, type TranscriptSnapshot,
} from './session';

interface Props {
  api: GroveApi;
  meetingId: string;
  /** Client account this meeting belongs to (e.g. from `?accountId=`). Its seeds then appear on that account. */
  accountId?: string | null;
  /** Called after extraction saves seeds so the forest can reload the grove. */
  onSeedsExtracted?: (seeds: Seed[]) => void;
}

interface Notice { text: string; kind: 'status' | 'alert' }

const EMPTY: TranscriptSnapshot = {
  entries: [], seeds: [], roots: [], extracting: false, pending: 0, speakers: [], error: null,
};
const NAME_KEY = 'grovekeeper.userName';

function clock(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// Per-browser convenience only; storage can be unavailable (private mode, blocked site data).
function readSavedName() {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}
function saveName(name: string) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* not persisted; still used this session */ }
}

function SpeakerRename({ label, onRename }: { label: string; onRename: (name: string) => Promise<void> }) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    await onRename(draft);
    setSaving(false);
    setDraft('');
  }
  return (
    <li>
      <form onSubmit={submit}>
        <label>{label} is{' '}
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="their name"
            maxLength={100} disabled={saving} />
        </label>{' '}
        <button type="submit" disabled={saving || !draft.trim()}>Rename</button>
      </form>
    </li>
  );
}

export function TranscriptPanel({ api, meetingId, accountId = null, onSeedsExtracted }: Props) {
  const [snapshot, setSnapshot] = useState<TranscriptSnapshot>(EMPTY);
  const [partials, setPartials] = useState<Partial<Record<AudioChannel, string>>>({});
  const [capturing, setCapturing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [userName, setUserName] = useState(readSavedName);
  const session = useRef<TranscriptSession | null>(null);
  const capture = useRef<OnlineCapture | null>(null);
  const startedAt = useRef<number | null>(null);
  const notified = useRef(onSeedsExtracted);
  notified.current = onSeedsExtracted;
  const unsupported = useMemo(() => checkTabCaptureSupport(browserEnvironment()), []);

  useEffect(() => {
    let seedCount = 0;
    const current = createTranscriptSession({
      api, meetingId, accountId,
      onChange: (next) => {
        setSnapshot(next);
        if (next.seeds.length !== seedCount) {
          seedCount = next.seeds.length;
          notified.current?.(next.seeds);
        }
      },
    });
    session.current = current;
    setSnapshot(EMPTY);
    let cancelled = false;
    // Show what this meeting already saved, so a reload never looks like lost work.
    api.getUtterances(meetingId).then(({ utterances }) => {
      if (cancelled || !current.restore(utterances)) return;
      // Continue the meeting clock after the last saved line instead of restarting at 0:00.
      const lastSec = Math.max(...utterances.map((utterance) => utterance.startSec));
      startedAt.current ??= Date.now() - (lastSec + 1) * 1000;
    }, (reason: unknown) => {
      if (!cancelled) {
        setNotice({ text: `Could not load the saved transcript: ${reason instanceof Error ? reason.message : 'unknown error'}`, kind: 'alert' });
      }
    });
    return () => {
      cancelled = true;
      current.dispose();
      void capture.current?.stop();
      capture.current = null;
      session.current = null;
    };
  }, [api, meetingId, accountId]);

  async function finish(reason: SessionEndReason, message: string | null) {
    capture.current = null;
    setCapturing(false);
    setPartials({});
    setNotice(message ? { text: message, kind: reason === 'share-ended' ? 'status' : 'alert' } : null);
    setBusy(true);
    // Whatever ended the share, saved speech still gets its final extraction.
    await session.current?.flush();
    setBusy(false);
  }

  async function share() {
    setBusy(true);
    setNotice(null);
    startedAt.current ??= Date.now();
    try {
      capture.current = await startOnlineCapture(api, {
        onPartial: (channel, text, speaker) => setPartials((current) => ({ ...current, [channel]: `${speaker}: ${text}` })),
        onFinal: (channel, segment) => {
          setPartials((current) => ({ ...current, [channel]: undefined }));
          void session.current?.add(segment);
        },
        onWarning: (text) => setNotice({ text, kind: 'alert' }),
        onEnded: (reason, message) => { void finish(reason, message); },
      }, { userName, baseSec: (Date.now() - startedAt.current) / 1000 });
      setCapturing(true);
    } catch (reason) {
      setNotice({ text: reason instanceof Error ? reason.message : 'Could not start capture.', kind: 'alert' });
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    await capture.current?.stop();
  }

  async function rename(label: string, name: string) {
    try {
      await session.current?.renameSpeaker(label, name);
    } catch (reason) {
      setNotice({ text: reason instanceof Error ? reason.message : 'Could not rename speaker.', kind: 'alert' });
    }
  }

  async function retryExtraction() {
    setBusy(true);
    await session.current?.flush();
    setBusy(false);
  }

  async function playFixture() {
    // Development aid: feeds the fixture transcript through the same save/extract path.
    setBusy(true);
    for (const item of demoUtterances) await session.current?.add(item);
    await session.current?.flush();
    setBusy(false);
  }

  const failed = snapshot.entries.some((entry) => entry.state === 'failed');
  // During capture the next 30 s window retries automatically; afterwards nothing would.
  const canRetryExtraction = !capturing && !snapshot.extracting && snapshot.pending > 0
    && (snapshot.error?.startsWith('Extraction failed') ?? false);
  const renamable = snapshot.speakers.filter((speaker) => speaker !== UNKNOWN_SPEAKER && speaker !== userName.trim());
  const live = (['mic', 'tab'] as const).map((channel) => partials[channel]).filter(Boolean);
  return (
    <section aria-labelledby="transcript-heading">
      <h2 id="transcript-heading">Live transcript</h2>
      <p>Transcribes an online meeting: share the Zoom, Meet or Teams tab, and your mic is added under your name.</p>
      <p>Saved to meeting <code>{meetingId}</code>{accountId && <> for account <code>{accountId}</code></>}.
        Lines and commitments are kept after a reload; commitments also appear in the forest above.</p>
      <p>
        <label>Your name{' '}
          <input value={userName} maxLength={100} disabled={capturing} autoComplete="name"
            onChange={(event) => { setUserName(event.target.value); saveName(event.target.value); }} />
        </label>
      </p>
      <p>
        {capturing
          ? <button type="button" onClick={stop} disabled={busy}>Stop sharing</button>
          : <button type="button" onClick={share} disabled={busy || unsupported !== null || !userName.trim()}>
              Share meeting tab
            </button>}
        {' '}
        <button type="button" onClick={playFixture} disabled={busy || capturing}>Play fixture transcript</button>
        {failed && <> {' '}<button type="button" onClick={() => session.current?.retryFailed()}>Retry unsaved</button></>}
        {canRetryExtraction && <> {' '}<button type="button" onClick={retryExtraction} disabled={busy}>Retry extraction</button></>}
      </p>
      {!userName.trim() && !unsupported && <p>Enter your name so your own lines and commitments are labelled.</p>}
      {unsupported && <p role="alert">{unsupported.message}</p>}
      {notice && <p role={notice.kind}>{notice.text}</p>}
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      {capturing && <p role="status">Transcribing the shared tab and your microphone.</p>}
      {snapshot.extracting && <p role="status">Extracting commitments…</p>}
      {renamable.length > 0 && (
        <section aria-labelledby="speakers-heading">
          <h3 id="speakers-heading">Speakers</h3>
          <p>Name the other participants. Saved lines and commitment owners update too.</p>
          <ul>{renamable.map((label) => (
            <SpeakerRename key={label} label={label} onRename={(name) => rename(label, name)} />
          ))}</ul>
        </section>
      )}
      <ol aria-live="polite">
        {snapshot.entries.map(({ utterance, state }) => (
          <li key={utterance.id}>
            [{clock(utterance.startSec)}] <strong>{utterance.speaker}</strong>: {utterance.text}
            {state === 'saving' && ' (saving…)'}
            {state === 'failed' && ' (not saved)'}
          </li>
        ))}
        {live.map((text) => <li key={text}><em>{text}</em></li>)}
      </ol>
      <h3>Extracted from this session</h3>
      {snapshot.seeds.length === 0 ? <p>No commitments or decisions yet.</p> : (
        <ul>{snapshot.seeds.map((seed) => (
          <li key={seed.id}>
            {seed.kind === 'decision' ? 'Decision' : 'Commitment'}: {seed.text}
            {' — '}{seed.owner ?? 'Owner not stated'}
            {' · '}{seed.deadline ?? 'No deadline stated'}
            {seed.timestampSec !== null && <> · at {clock(seed.timestampSec)}</>}
          </li>
        ))}</ul>
      )}
    </section>
  );
}
