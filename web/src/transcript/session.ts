import type { GroveApi } from '../api/contracts';
import type { Root, Seed, Utterance } from '../types';

/** A finalized phrase from Speech (or a confirmed Leaves sentence). */
export interface FinalSegment {
  speaker: string;
  text: string;
  startSec: number;
  via?: Utterance['via'];
}

export interface TranscriptEntry {
  utterance: Utterance;
  state: 'saving' | 'saved' | 'failed';
}

export interface TranscriptSnapshot {
  entries: TranscriptEntry[];
  seeds: Seed[];
  roots: Root[];
  extracting: boolean;
  error: string | null;
}

export interface TranscriptSessionOptions {
  api: Pick<GroveApi, 'saveUtterance' | 'extract'>;
  meetingId: string;
  /** Seconds of new transcript that trigger an extraction window. */
  windowSec?: number;
  /** Already-extracted context re-sent with each window; the server deduplicates it. */
  overlapSec?: number;
  /** Wall-clock fallback so a quiet meeting still extracts pending speech. */
  maxWaitMs?: number;
  newId?: () => string;
  onChange?: (snapshot: TranscriptSnapshot) => void;
}

const MAX_WINDOW = 200;

function describe(reason: unknown) {
  return reason instanceof Error ? reason.message : 'Unexpected error';
}

export function createTranscriptSession({
  api, meetingId, windowSec = 30, overlapSec = 10, maxWaitMs = 30_000,
  newId = () => crypto.randomUUID(), onChange,
}: TranscriptSessionOptions) {
  const entries: TranscriptEntry[] = [];
  const extracted = new Set<string>();
  const seeds = new Map<string, Seed>();
  const roots = new Map<string, Root>();
  let extracting: Promise<void> | null = null;
  let rerun = false;
  let error: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const snapshot = (): TranscriptSnapshot => structuredClone({
    entries, seeds: [...seeds.values()], roots: [...roots.values()], extracting: extracting !== null, error,
  });
  const emit = () => onChange?.(snapshot());
  const byTime = (a: TranscriptEntry, b: TranscriptEntry) => a.utterance.startSec - b.utterance.startSec;
  const saved = () => entries.filter((entry) => entry.state === 'saved').sort(byTime).map((entry) => entry.utterance);
  const pending = () => saved().filter((utterance) => !extracted.has(utterance.id));

  function schedule() {
    if (timer || !pending().length) return;
    timer = setTimeout(() => { timer = null; void extractPending(); }, maxWaitMs);
  }

  async function save(entry: TranscriptEntry) {
    entry.state = 'saving';
    emit();
    try {
      // The same utterance ID is reused on retry; the server upserts by meeting/id.
      await api.saveUtterance(entry.utterance);
      entry.state = 'saved';
    } catch (reason) {
      entry.state = 'failed';
      error = `Utterance not saved: ${describe(reason)}`;
    }
    emit();
    const waiting = pending();
    if (waiting.length && waiting[waiting.length - 1].startSec - waiting[0].startSec >= windowSec) {
      await extractPending();
    } else {
      schedule();
    }
  }

  async function runExtraction(): Promise<boolean> {
    const window = pending().slice(0, MAX_WINDOW);
    if (!window.length) return true;
    const context = saved().filter((utterance) => extracted.has(utterance.id)
      && utterance.startSec >= window[0].startSec - overlapSec && utterance.startSec <= window[0].startSec);
    const utterances = [...context, ...window].slice(-MAX_WINDOW);
    try {
      const result = await api.extract({ meetingId, utterances });
      for (const utterance of window) extracted.add(utterance.id);
      // Overlapping windows return the same seed IDs; the latest server copy wins.
      for (const seed of result.seeds) seeds.set(seed.id, seed);
      for (const root of result.roots) roots.set(root.id, root);
      error = null;
      return true;
    } catch (reason) {
      // Leave the window pending so the next trigger or flush retries it.
      error = `Extraction failed: ${describe(reason)}`;
      return false;
    }
  }

  function extractPending(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; }
    if (extracting) { rerun = true; return extracting; }
    extracting = (async () => {
      let ok = true;
      do {
        rerun = false;
        emit();
        ok = await runExtraction();
      } while (ok && (rerun || pending().length > 0));
    })().finally(() => {
      extracting = null;
      emit();
      schedule();
    });
    return extracting;
  }

  return {
    meetingId,
    snapshot,
    /** Saves a finalized segment, then extracts once ~windowSec of new transcript is saved. */
    add(segment: FinalSegment): Promise<void> {
      const text = segment.text.trim();
      if (!text) return Promise.resolve();
      const entry: TranscriptEntry = {
        utterance: {
          id: newId(), meetingId, speaker: segment.speaker.trim() || 'Unknown speaker', text,
          startSec: Math.max(0, segment.startSec), via: segment.via ?? 'voice',
        },
        state: 'saving',
      };
      entries.push(entry);
      return save(entry);
    },
    async retryFailed() {
      error = null;
      await Promise.all(entries.filter((entry) => entry.state === 'failed').map(save));
    },
    /** Extracts everything saved but not yet extracted, e.g. when the mic stops. */
    flush: extractPending,
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export type TranscriptSession = ReturnType<typeof createTranscriptSession>;
