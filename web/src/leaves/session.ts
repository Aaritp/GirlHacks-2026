import type { GroveApi } from '../api/contracts';
import type { Seed, Utterance } from '../types';

export interface PreparedSpeech {
  /** Calls onStarted once, only after playback starts; resolves when playback ends. */
  start(onStarted: () => void): Promise<void>;
  cancel(): void;
}
export interface SpeechOutput {
  prepare(text: string, signal: AbortSignal): Promise<PreparedSpeech>;
}
export interface LeavesSnapshot {
  preview: string;
  confirmed: boolean;
  busy: boolean;
  composing: boolean;
  pending: boolean;
  saving: boolean;
  message: string;
  error: string;
}

export function createLeavesSession(options: {
  api: GroveApi; speech: SpeechOutput; meetingId: string; speaker: string;
  /** Preserve the account link even when Leaves is the meeting's first contribution. */
  accountId?: string | null;
  getStartSec: () => number; onChange?: (state: LeavesSnapshot) => void;
  onSeeds?: (seeds: Seed[]) => void; newId?: () => string;
  onUtteranceStarted?: (utterance: Utterance) => void;
}) {
  let state: LeavesSnapshot = { preview: '', confirmed: false, busy: false,
    composing: false, pending: false, saving: false, message: '', error: '' };
  let revision = 0;
  let composition = 0;
  let disposed = false;
  let abort: AbortController | undefined;
  let prepared: PreparedSpeech | undefined;
  let pending: { utterance: Utterance; saved: boolean } | undefined;
  let persistTask: Promise<void> | undefined;
  const notify = () => { if (!disposed) options.onChange?.({ ...state }); };
  const message = (reason: unknown) => reason instanceof Error ? reason.message : 'The operation failed.';
  function edit(text: string) {
    revision++;
    composition++;
    abort?.abort();
    prepared?.cancel();
    state = { ...state, preview: text, confirmed: false, composing: false, error: '', message: 'Review the preview before confirming.' };
    notify();
  }
  async function persist() {
    if (persistTask) return persistTask;
    const entry = pending;
    if (!entry) return;
    state.saving = true;
    state.error = '';
    persistTask = (async () => {
      try {
        if (!entry.saved) {
          await options.api.saveUtterance(entry.utterance);
          entry.saved = true;
        }
        const grove = await options.api.extract({ meetingId: entry.utterance.meetingId,
          accountId: options.accountId, utterances: [entry.utterance] });
        if (!disposed) options.onSeeds?.(grove.seeds);
        pending = undefined;
        state.pending = false;
        state.message = 'Spoken contribution saved.';
      } catch (reason) {
        state.error = (entry.saved ? 'Contribution saved; extraction failed. ' : 'Speech started, but saving failed. ')
          + message(reason) + ' Retry saving; this will not speak again.';
      } finally {
        state.saving = false;
        notify();
      }
    })();
    notify();
    try { await persistTask; } finally { persistTask = undefined; }
  }
  return {
    snapshot: () => ({ ...state }),
    edit,
    async compose(picked: string[]) {
      if (!picked.length) return;
      edit(state.preview);
      const ticket = ++composition;
      const version = revision;
      state.composing = true;
      notify();
      try {
        const result = await options.api.compose({ meetingId: options.meetingId, picked });
        if (!disposed && ticket === composition && version === revision) edit(result.sentence);
      } catch (reason) {
        if (!disposed && ticket === composition) { state.error = message(reason); notify(); }
      } finally {
        if (!disposed && ticket === composition) { state.composing = false; notify(); }
      }
    },
    confirm() {
      if (disposed || state.busy || state.composing || state.pending || !state.preview.trim()
        || state.preview.length > 20000 || !options.speaker.trim()) return;
      state.confirmed = true;
      state.error = '';
      state.message = 'Confirmed. Select Speak to say this exact preview.';
      notify();
    },
    async speak() {
      if (disposed || !state.confirmed || state.busy || state.pending) return;
      const version = revision;
      const text = state.preview;
      const attempt = new AbortController();
      abort = attempt;
      state.confirmed = false; // A confirmation authorizes one attempt only.
      state.busy = true;
      state.error = '';
      state.message = 'Preparing Azure Speech…';
      notify();
      let started = false;
      let audio: PreparedSpeech | undefined;
      try {
        audio = await options.speech.prepare(text, attempt.signal);
        prepared = audio;
        if (disposed || attempt.signal.aborted || version !== revision) return;
        await audio.start(() => {
          if (started || disposed || attempt.signal.aborted || version !== revision) return;
          started = true;
          const startSec = options.getStartSec();
          pending = { saved: false, utterance: {
            id: options.newId?.() ?? crypto.randomUUID(), meetingId: options.meetingId,
            speaker: options.speaker, text, via: 'leaves',
            startSec: Number.isFinite(startSec) ? Math.max(0, startSec) : 0,
          } };
          state.pending = true;
          state.message = 'Speaking. Saving your contribution…';
          notify();
          const utterance = pending.utterance;
          void persist();
          options.onUtteranceStarted?.(utterance);
        });
      } catch (reason) {
        if (!attempt.signal.aborted && !disposed) {
          state.error = (started ? 'Playback was interrupted. ' : 'Speech did not start. ') + message(reason);
        }
      } finally {
        audio?.cancel();
        if (prepared === audio) prepared = undefined;
        state.busy = false;
        notify();
      }
    },
    retrySave: persist,
    cancel() {
      edit(state.preview);
      state.message = 'Speech canceled. Confirm again before speaking.';
      notify();
    },
    dispose() {
      disposed = true;
      revision++;
      composition++;
      abort?.abort();
      prepared?.cancel();
    },
  };
}
export type LeavesSession = ReturnType<typeof createLeavesSession>;
