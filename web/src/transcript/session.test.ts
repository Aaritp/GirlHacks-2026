import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type GroveApi } from '../api/contracts';
import { createMockApi } from '../api/mocks';
import type { ExtractRequest } from '../types';
import { createTranscriptSession, type TranscriptSnapshot } from './session';
import { speakerLabel } from './speech';

const MEETING = 'meeting-a';

function setup(overrides: Partial<Pick<GroveApi, 'saveUtterance' | 'extract'>> = {}) {
  const backing = createMockApi({ seeds: [], roots: [] });
  const api = {
    saveUtterance: vi.fn(overrides.saveUtterance ?? backing.saveUtterance),
    extract: vi.fn(overrides.extract ?? backing.extract),
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
    fail = false;
    await session.flush();
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
});
