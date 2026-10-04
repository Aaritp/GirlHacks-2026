import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type GroveApi } from '../api/contracts';
import { createMockApi } from '../api/mocks';
import type { ExtractRequest } from '../types';
import { createTranscriptSession, type TranscriptSnapshot } from './session';
import { speakerLabel } from './speech';

const MEETING = 'meeting-a';

function setup(overrides: Partial<Pick<GroveApi, 'saveUtterance' | 'extract' | 'updateSeed'>> = {}) {
  const backing = createMockApi({ seeds: [], roots: [] });
  const api = {
    saveUtterance: vi.fn(overrides.saveUtterance ?? backing.saveUtterance),
    extract: vi.fn(overrides.extract ?? backing.extract),
    updateSeed: vi.fn(overrides.updateSeed ?? backing.updateSeed),
  };
  let counter = 0;
  let latest: TranscriptSnapshot | null = null;
  const session = createTranscriptSession({
    api, meetingId: MEETING, newId: () => `u${++counter}`, onChange: (next) => { latest = next; },
  });
  return { api, backing, session, latest: () => latest! };
}

const say = (startSec: number, text = `Line at ${startSec}`, speaker = 'Guest-1') => ({ speaker, text, startSec });
const windowIds = (call: [ExtractRequest]) => call[0].utterances.map((item) => item.id);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('transcript session', () => {
  it('saves each finalized utterance and extracts once ~30s of new transcript exists', async () => {
    const { api, session, backing } = setup();
    await session.add(say(0));
    await session.add(say(14));
    expect(api.saveUtterance).toHaveBeenCalledTimes(2);
    expect(api.extract).not.toHaveBeenCalled();
    await session.add(say(31));
    expect(api.extract).toHaveBeenCalledTimes(1);
    expect(windowIds(api.extract.mock.calls[0])).toEqual(['u1', 'u2', 'u3']);
    expect(api.saveUtterance.mock.calls[0][0]).toEqual({
      id: 'u1', meetingId: MEETING, speaker: 'Guest-1', text: 'Line at 0', startSec: 0, via: 'voice',
    });
    // Saved seeds are retrievable through the same API as the forest uses.
    expect((await backing.getGrove(MEETING)).seeds).toHaveLength(3);
  });

  it('sends overlapping context and deduplicates seeds returned by consecutive windows', async () => {
    const { api, session, latest } = setup();
    for (const t of [0, 25, 31]) await session.add(say(t));
    for (const t of [40, 55, 72]) await session.add(say(t));
    expect(api.extract).toHaveBeenCalledTimes(2);
    // u3 (31s) is within 10s of the second window start (40s) and is re-sent as context.
    expect(windowIds(api.extract.mock.calls[1])).toEqual(['u3', 'u4', 'u5', 'u6']);
    const ids = latest().seeds.map((seed) => seed.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('extracts quiet-meeting speech after the wall-clock fallback and on flush', async () => {
    const { api, session } = setup();
    await session.add(say(0));
    expect(api.extract).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.extract).toHaveBeenCalledTimes(1);
    await session.add(say(5));
    await session.flush();
    expect(api.extract).toHaveBeenCalledTimes(2);
    expect(windowIds(api.extract.mock.calls[1])).toEqual(['u1', 'u2']);
  });

  it('never extracts unsaved speech and retries saves with the same utterance ID', async () => {
    const backing = createMockApi({ seeds: [], roots: [] });
    let failSave = true;
    const { api, session, latest } = setup({
      saveUtterance: async (utterance) => {
        if (failSave) throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Storage is temporarily unavailable.');
        return backing.saveUtterance(utterance);
      },
    });
    await session.add(say(0));
    await session.flush();
    expect(api.extract).not.toHaveBeenCalled();
    expect(latest().entries[0].state).toBe('failed');
    expect(latest().error).toMatch(/not saved: Storage is temporarily unavailable/);
    failSave = false;
    await session.retryFailed();
    await session.flush();
    expect(api.saveUtterance.mock.calls.map(([item]) => item.id)).toEqual(['u1', 'u1']);
    expect(api.extract).toHaveBeenCalledTimes(1);
  });

  it('reports extraction failure without inventing seeds and retries the window later', async () => {
    const backing = createMockApi({ seeds: [], roots: [] });
    let fail = true;
    const { api, session, latest } = setup({
      extract: async (request) => {
        if (fail) throw new ApiError(502, 'UPSTREAM_ERROR', 'Azure OpenAI extraction failed; nothing was extracted.');
        return backing.extract(request);
      },
    });
    await session.add(say(0));
    await session.flush();
    expect(latest().seeds).toEqual([]);
    expect(latest().error).toMatch(/Extraction failed: Azure OpenAI/);
    expect(latest().pending).toBe(1);
    fail = false;
    await session.flush();
    expect(latest().pending).toBe(0);
    expect(windowIds(api.extract.mock.calls[1])).toEqual(['u1']);
    expect(latest().seeds).toHaveLength(1);
    expect(latest().error).toBeNull();
  });

  it('runs one extraction at a time and picks up utterances that arrive meanwhile', async () => {
    const backing = createMockApi({ seeds: [], roots: [] });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { api, session } = setup({ extract: async (request) => { await gate; return backing.extract(request); } });
    await session.add(say(0));
    const first = session.flush();
    await session.add(say(3));
    const second = session.flush();
    expect(api.extract).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(api.extract).toHaveBeenCalledTimes(2);
    expect(windowIds(api.extract.mock.calls[1])).toContain('u2');
  });

  it('ignores blank phrases and labels unidentified speakers honestly', async () => {
    const { api, session } = setup();
    await session.add(say(0, '   '));
    expect(api.saveUtterance).not.toHaveBeenCalled();
    expect(speakerLabel('Unknown')).toBe('Unknown speaker');
    expect(speakerLabel('')).toBe('Unknown speaker');
    expect(speakerLabel('Guest-2')).toBe('Guest-2');
  });

  it('renames a speaker everywhere: transcript, saved utterances, owners, and future lines', async () => {
    const { api, session, latest, backing } = setup();
    await session.add(say(0, "I'll send the deck.", 'Guest-1'));
    await session.add(say(5, 'Sounds good.', 'Guest-2'));
    await session.flush();
    // The mock extractor makes the speaker the owner, like a first-person promise.
    expect(latest().seeds.map((seed) => seed.owner)).toEqual(['Guest-1', 'Guest-2']);
    api.saveUtterance.mockClear();

    await session.renameSpeaker('Guest-1', 'Sam');
    expect(latest().entries.map((entry) => entry.utterance.speaker)).toEqual(['Sam', 'Guest-2']);
    // Re-saved with the same ID: the server upserts instead of duplicating.
    expect(api.saveUtterance.mock.calls.map(([u]) => [u.id, u.speaker])).toEqual([['u1', 'Sam']]);
    expect(latest().seeds.map((seed) => seed.owner)).toEqual(['Sam', 'Guest-2']);
    expect((await backing.getGrove(MEETING)).seeds.find((seed) => seed.owner === 'Sam')).toBeDefined();
    expect(latest().speakers).toEqual(['Sam', 'Guest-2']);

    await session.add(say(9, 'One more thing.', 'Guest-1'));
    expect(latest().entries[2].utterance.speaker).toBe('Sam');
  });

  it('patches owners on extraction results that were in flight during a rename', async () => {
    const backing = createMockApi({ seeds: [], roots: [] });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { api, session, latest } = setup({
      extract: async (request) => { await gate; return backing.extract(request); },
      updateSeed: backing.updateSeed,
    });
    await session.add(say(0, "I'll book the room.", 'Guest-3'));
    const extraction = session.flush();
    await session.renameSpeaker('Guest-3', 'Priya');
    release();
    await extraction;
    expect(api.updateSeed).toHaveBeenCalledWith(MEETING, expect.any(String), { owner: 'Priya' });
    expect(latest().seeds[0].owner).toBe('Priya');
    expect(latest().error).toBeNull();
  });

  it('merges when renamed to an existing name and follows chained renames', async () => {
    const { session, latest } = setup();
    await session.add(say(0, 'First.', 'Guest-1'));
    await session.add(say(2, 'Second.', 'Guest-2'));
    await session.renameSpeaker('Guest-1', 'Sam');
    await session.renameSpeaker('Guest-2', 'Sam');
    expect(latest().speakers).toEqual(['Sam']);
    await session.renameSpeaker('Sam', 'Samantha');
    await session.add(say(4, 'Third.', 'Guest-1'));
    expect(latest().entries.map((entry) => entry.utterance.speaker)).toEqual(['Samantha', 'Samantha', 'Samantha']);
  });

  it('rejects renaming Unknown speaker or to a blank name, and reports owner patch failures', async () => {
    const { session, latest } = setup({
      updateSeed: async () => { throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Storage is temporarily unavailable.'); },
    });
    await expect(session.renameSpeaker('Unknown speaker', 'Sam')).rejects.toThrow(/cannot be renamed/);
    await expect(session.renameSpeaker('Guest-1', '   ')).rejects.toThrow(/1-100 characters/);
    await session.add(say(0, "I'll call them.", 'Guest-1'));
    await session.flush();
    await session.renameSpeaker('Guest-1', 'Sam');
    expect(latest().error).toMatch(/Could not rename the owner of .*Storage is temporarily unavailable/);
    expect(latest().entries[0].utterance.speaker).toBe('Sam');
  });

  it('sends the account with every extraction when the meeting is linked to one', async () => {
    const backing = createMockApi({ seeds: [], roots: [] });
    const extract = vi.fn(backing.extract);
    const linked = createTranscriptSession({
      api: { ...backing, extract }, meetingId: MEETING, accountId: 'acct-northwind', newId: () => 'a1',
    });
    await linked.add(say(0, "I'll send the plan."));
    await linked.flush();
    expect(extract.mock.calls[0][0]).toMatchObject({ meetingId: MEETING, accountId: 'acct-northwind' });
    expect(linked.snapshot().seeds[0].accountId).toBe('acct-northwind');

    const { api, session } = setup();
    await session.add(say(0, 'Hello.'));
    await session.flush();
    expect(api.extract.mock.calls[0][0]).not.toHaveProperty('accountId');
  });

  it('restores a saved transcript in order without re-extracting or duplicating it', async () => {
    const { api, session, latest } = setup();
    const saved = [
      { id: 'old-2', meetingId: MEETING, speaker: 'Sam', text: 'Second.', startSec: 20, via: 'voice' as const },
      { id: 'old-1', meetingId: MEETING, speaker: 'Prisha', text: 'First.', startSec: 5, via: 'voice' as const },
      { id: 'elsewhere', meetingId: 'other', speaker: 'X', text: 'Not ours.', startSec: 1, via: 'voice' as const },
    ];
    expect(session.restore(saved)).toBe(2);
    expect(session.restore(saved)).toBe(0);
    expect(latest().entries.map((entry) => [entry.utterance.id, entry.state])).toEqual([['old-1', 'saved'], ['old-2', 'saved']]);
    expect(latest().pending).toBe(0);
    await session.add(say(30, 'New line.'));
    await session.flush();
    // old-2 is within 10 s of the new line, so it is re-sent only as overlap context; old-1 is not.
    expect(windowIds(api.extract.mock.calls[0])).toEqual(['old-2', 'u1']);
    expect(api.saveUtterance.mock.calls.map(([u]) => u.id)).toEqual(['u1']);
  });
});
