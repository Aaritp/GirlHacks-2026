import { useEffect, useRef, useState } from 'react';
import type { GroveApi } from '../api/contracts';
import { demoUtterances } from '../api/fixtures';
import type { Seed } from '../types';
import { createTranscriptSession, type TranscriptSession, type TranscriptSnapshot } from './session';
import { startLiveTranscriber, type LiveTranscriber } from './speech';

interface Props {
  api: GroveApi;
  meetingId: string;
  /** Optional app-owned clock shared with Leaves. */
  meetingStartedAt?: number;
  /** Disable the legacy microphone path while the online tab-capture owner integrates it. */
  allowMicrophone?: boolean;
  /** Called after extraction saves seeds so the forest can reload the grove. */
  onSeedsExtracted?: (seeds: Seed[]) => void;
}

const EMPTY: TranscriptSnapshot = { entries: [], seeds: [], roots: [], extracting: false, error: null };

function clock(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function TranscriptPanel({ api, meetingId, onSeedsExtracted, meetingStartedAt, allowMicrophone = true }: Props) {
  const [snapshot, setSnapshot] = useState<TranscriptSnapshot>(EMPTY);
  const [partial, setPartial] = useState('');
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [micError, setMicError] = useState('');
  const session = useRef<TranscriptSession | null>(null);
  const live = useRef<LiveTranscriber | null>(null);
  const startedAt = useRef<number | null>(null);
  const notified = useRef(onSeedsExtracted);
  notified.current = onSeedsExtracted;

  useEffect(() => {
    let seedCount = 0;
    const current = createTranscriptSession({
      api, meetingId,
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
    return () => {
      current.dispose();
      void live.current?.stop();
      live.current = null;
      session.current = null;
    };
  }, [api, meetingId]);

  async function start() {
    setBusy(true);
    setMicError('');
    startedAt.current ??= meetingStartedAt ?? Date.now();
    try {
      live.current = await startLiveTranscriber(api, {
        onPartial: (text, speaker) => setPartial(`${speaker}: ${text}`),
        onFinal: (segment) => { setPartial(''); void session.current?.add(segment); },
        onError: setMicError,
      }, { baseSec: (Date.now() - startedAt.current) / 1000 });
      setListening(true);
    } catch (reason) {
      setMicError(reason instanceof Error ? reason.message : 'Could not start transcription.');
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    await live.current?.stop();
    live.current = null;
    setListening(false);
    setPartial('');
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
  return (
    <section aria-labelledby="transcript-heading">
      <h2 id="transcript-heading">Live transcript</h2>
      <p>
        {allowMicrophone && (listening
          ? <button type="button" onClick={stop} disabled={busy}>Stop listening</button>
          : <button type="button" onClick={start} disabled={busy}>Start listening</button>)}
        {' '}
        <button type="button" onClick={playFixture} disabled={busy || listening}>Play fixture transcript</button>
        {failed && <> {' '}<button type="button" onClick={() => session.current?.retryFailed()}>Retry unsaved</button></>}
      </p>
      {micError && <p role="alert">{micError}</p>}
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      {snapshot.extracting && <p role="status">Extracting commitments…</p>}
      <ol aria-live="polite">
        {snapshot.entries.map(({ utterance, state }) => (
          <li key={utterance.id}>
            [{clock(utterance.startSec)}] <strong>{utterance.speaker}</strong>: {utterance.text}
            {state === 'saving' && ' (saving…)'}
            {state === 'failed' && ' (not saved)'}
          </li>
        ))}
        {partial && <li><em>{partial}</em></li>}
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
