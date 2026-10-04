import type { GroveApi } from '../api/contracts';
import type { CompletionSuggestion, Root, Seed, Utterance } from '../types';

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
  /** Saved utterances not yet sent to a successful extraction. */
  pending: number;
  /** Current speaker names in order of first appearance (after renames). */
  speakers: string[];
  /** Open commitments the transcript says are done, awaiting the user's Yes / No. */
  suggestions: CompletionSuggestion[];
  error: string | null;
}

export interface TranscriptSessionOptions {
  api: Pick<GroveApi, 'saveUtterance' | 'extract' | 'updateSeed'>;
  meetingId: string;
  /** Links the meeting to a client account; sent with every extraction (409 if linked elsewhere). */
  accountId?: string | null;
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
export const UNKNOWN_SPEAKER = 'Unknown speaker';
const MAX_NAME_LENGTH = 100;

function describe(reason: unknown) {
  return reason instanceof Error ? reason.message : 'Unexpected error';
}

export function createTranscriptSession({
  api, meetingId, accountId = null, windowSec = 30, overlapSec = 10, maxWaitMs = 30_000,
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
  // Speaker label (e.g. Guest-1) -> name the user gave it. Labels are per capture session.
  const names = new Map<string, string>();
  const saveChains = new Map<string, Promise<void>>();
  const nameFor = (label: string) => names.get(label) ?? label;
  // Completion suggestions awaiting an answer, and seeds already answered (never re-asked).
  const suggestions = new Map<string, CompletionSuggestion>();
  const answered = new Set<string>();

  const snapshot = (): TranscriptSnapshot => structuredClone({
    entries, seeds: [...seeds.values()], roots: [...roots.values()], extracting: extracting !== null,
    pending: pending().length, speakers: [...new Set(entries.map((entry) => entry.utterance.speaker))],
    suggestions: [...suggestions.values()], error,
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
    // Saves of one utterance run in order, so a re-save after a rename lands last.
    const id = entry.utterance.id;
    const run = (saveChains.get(id) ?? Promise.resolve()).then(async () => {
      try {
        // The same utterance ID is reused on retry; the server upserts by meeting/id.
        await api.saveUtterance(entry.utterance);
        entry.state = 'saved';
      } catch (reason) {
        entry.state = 'failed';
        error = `Utterance not saved: ${describe(reason)}`;
      }
    });
    saveChains.set(id, run);
    await run;
    if (saveChains.get(id) === run) saveChains.delete(id);
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
      const result = await api.extract(accountId ? { meetingId, utterances, accountId } : { meetingId, utterances });
      for (const utterance of window) extracted.add(utterance.id);
      // Overlapping windows return the same seed IDs; the latest server copy wins.
      for (const seed of result.seeds) seeds.set(seed.id, seed);
      for (const root of result.roots) roots.set(root.id, root);
      for (const suggestion of result.completions ?? []) {
        if (!answered.has(suggestion.seedId) && !suggestions.has(suggestion.seedId)) suggestions.set(suggestion.seedId, suggestion);
      }
      error = null;
      // A window sent before a rename comes back with the old label as owner.
      await relabelOwners(result.seeds.filter((seed) => seed.owner && nameFor(seed.owner) !== seed.owner));
      return true;
    } catch (reason) {
      // Leave the window pending so the next trigger or flush retries it.
      error = `Extraction failed: ${describe(reason)}`;
      return false;
    }
  }

  async function relabelOwners(stale: Seed[]) {
    await Promise.all(stale.map(async (seed) => {
      try {
        seeds.set(seed.id, await api.updateSeed(meetingId, seed.id, { owner: nameFor(seed.owner!) }));
      } catch (reason) {
        error = `Could not rename the owner of "${seed.text}": ${describe(reason)}`;
      }
    }));
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
          id: newId(), meetingId, speaker: nameFor(segment.speaker.trim() || UNKNOWN_SPEAKER), text,
          startSec: Math.max(0, segment.startSec), via: segment.via ?? 'voice',
        },
        state: 'saving',
      };
      entries.push(entry);
      return save(entry);
    },
    /**
     * Names a speaker label for this session: future phrases use it, saved utterances are
     * re-saved with it, and seeds this session extracted with the old label as owner are
     * patched. Renaming to an existing name merges the two (diarization sometimes splits one voice).
     */
    /**
     * Confirms a suggested completion: the seed blooms and records the evidence. Nothing is
     * ever closed without this explicit confirmation.
     */
    async confirmCompletion(seedId: string) {
      const suggestion = suggestions.get(seedId);
      if (!suggestion) return;
      try {
        const updated = await api.updateSeed(suggestion.meetingId, seedId, {
          status: 'bloom', lastActivity: new Date().toISOString(),
          completedBy: { sourceId: suggestion.sourceId, sourceType: suggestion.sourceType,
            quote: suggestion.evidenceQuote, timestampSec: suggestion.timestampSec },
        });
        suggestions.delete(seedId);
        answered.add(seedId);
        if (seeds.has(seedId)) seeds.set(seedId, updated);
      } catch (reason) {
        error = `Could not mark "${suggestion.seedText}" as done: ${describe(reason)}`;
      }
      emit();
    },
    /** Declines a suggestion; that commitment is not suggested again in this session. */
    dismissCompletion(seedId: string) {
      suggestions.delete(seedId);
      answered.add(seedId);
      emit();
    },
    /**
     * Shows a meeting's previously saved transcript (e.g. after a reload). Restored lines count as
     * already extracted, so they are not re-sent; new lines with the same id are never duplicated.
     */
    restore(saved: Utterance[]) {
      const known = new Set(entries.map((entry) => entry.utterance.id));
      const restored = saved.filter((utterance) => utterance.meetingId === meetingId && !known.has(utterance.id))
        .sort((a, b) => a.startSec - b.startSec)
        .map((utterance): TranscriptEntry => ({ utterance: structuredClone(utterance), state: 'saved' }));
      for (const entry of restored) extracted.add(entry.utterance.id);
      entries.unshift(...restored);
      emit();
      return restored.length;
    },
    async renameSpeaker(from: string, to: string) {
      const target = to.trim();
      if (from === UNKNOWN_SPEAKER) throw new Error('Unknown speaker can be several people, so it cannot be renamed.');
      if (!target || target.length > MAX_NAME_LENGTH) throw new Error(`Names must be 1-${MAX_NAME_LENGTH} characters.`);
      if (target === from) return;
      names.set(from, target);
      for (const [label, name] of names) if (name === from) names.set(label, target);
      const touched = entries.filter((entry) => entry.utterance.speaker === from);
      for (const entry of touched) entry.utterance = { ...entry.utterance, speaker: target };
      emit();
      await Promise.all(touched.map(save));
      await relabelOwners([...seeds.values()].filter((seed) => seed.owner === from));
      emit();
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
