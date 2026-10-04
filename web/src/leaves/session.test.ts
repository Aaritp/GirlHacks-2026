import { describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../api/mocks';
import { createLeavesSession, type PreparedSpeech, type SpeechOutput } from './session';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
function setup() {
  const api = createMockApi({ seeds: [], roots: [] });
  const save = vi.spyOn(api, 'saveUtterance');
  const extract = vi.spyOn(api, 'extract');
  let started: (() => void) | undefined;
  const ending = deferred<void>();
  const audio: PreparedSpeech = {
    start: vi.fn((callback) => { started = callback; return ending.promise; }),
    cancel: vi.fn(() => ending.resolve()),
  };
  const speech: SpeechOutput = { prepare: vi.fn(async () => audio) };
  const session = createLeavesSession({ api, speech, meetingId: 'meeting-a', speaker: 'Alex',
    getStartSec: () => 42, newId: () => 'stable-id' });
  return { api, session, speech, audio, save, extract, start: () => started?.(), end: () => ending.resolve() };
}

describe('Leaves confirmation and spoken contributions', () => {
  it('drafts and composition never speak or save', async () => {
    const s = setup();
    await s.session.compose(["I'll review", 'Quetzal-X9', 'résumé', '東京.']);
    expect(s.session.snapshot().preview).toBe("I'll review Quetzal-X9 résumé 東京.");
    await s.session.speak();
    expect(s.speech.prepare).not.toHaveBeenCalled();
    expect(s.save).not.toHaveBeenCalled();
  });

  it('editing even to the same text invalidates confirmation', async () => {
    const s = setup();
    s.session.edit('Hello');
    s.session.confirm();
    s.session.edit('Hello');
    await s.session.speak();
    expect(s.session.snapshot().confirmed).toBe(false);
    expect(s.speech.prepare).not.toHaveBeenCalled();
  });

  it('records only once when playback actually starts, with meeting, speaker and via', async () => {
    const s = setup();
    s.session.edit('I will review Quetzal-X9.');
    s.session.confirm();
    const speaking = s.session.speak();
    await vi.waitFor(() => expect(s.audio.start).toHaveBeenCalledOnce());
    expect(s.save).not.toHaveBeenCalled();
    s.start(); s.start();
    await vi.waitFor(() => expect(s.save).toHaveBeenCalledOnce());
    expect(s.save).toHaveBeenCalledWith({ id: 'stable-id', meetingId: 'meeting-a', speaker: 'Alex',
      startSec: 42, text: 'I will review Quetzal-X9.', via: 'leaves' });
    await vi.waitFor(() => expect(s.session.snapshot().pending).toBe(false));
    expect((await s.api.getGrove('meeting-a')).seeds[0].sourceType).toBe('leaves');
    expect((await s.api.getGrove('other')).seeds).toEqual([]);
    s.end(); await speaking;
    await s.session.speak();
    expect(s.speech.prepare).toHaveBeenCalledOnce();
  });

  it('save retries retain identity and never replay audio', async () => {
    const s = setup();
    s.save.mockRejectedValueOnce(new Error('Network lost after request'));
    s.session.edit('I can help.');
    s.session.confirm();
    const speaking = s.session.speak();
    await vi.waitFor(() => expect(s.audio.start).toHaveBeenCalledOnce());
    s.start(); s.end(); await speaking;
    await vi.waitFor(() => expect(s.session.snapshot().saving).toBe(false));
    await Promise.all([s.session.retrySave(), s.session.retrySave()]);
    expect(s.save).toHaveBeenCalledTimes(2);
    expect(s.save.mock.calls[0][0]).toEqual(s.save.mock.calls[1][0]);
    expect(s.speech.prepare).toHaveBeenCalledOnce();
    expect((await s.api.getGrove('meeting-a')).seeds).toHaveLength(1);
  });

  it('extraction retry does not save again or replay', async () => {
    const s = setup();
    s.extract.mockRejectedValueOnce(new Error('Extraction offline'));
    s.session.edit('I can help.');
    s.session.confirm();
    const speaking = s.session.speak();
    await vi.waitFor(() => expect(s.audio.start).toHaveBeenCalledOnce());
    s.start(); s.end(); await speaking;
    await vi.waitFor(() => expect(s.session.snapshot().error).toContain('extraction failed'));
    await s.session.retrySave();
    expect(s.save).toHaveBeenCalledOnce();
    expect(s.extract).toHaveBeenCalledTimes(2);
    expect(s.speech.prepare).toHaveBeenCalledOnce();
  });

  it('editing during token/synthesis delay cancels old audio', async () => {
    const s = setup();
    const ready = deferred<PreparedSpeech>();
    vi.mocked(s.speech.prepare).mockReturnValue(ready.promise);
    s.session.edit('Old text');
    s.session.confirm();
    const speaking = s.session.speak();
    s.session.edit('New text');
    ready.resolve(s.audio);
    await speaking;
    expect(s.audio.start).not.toHaveBeenCalled();
    expect(s.audio.cancel).toHaveBeenCalled();
    expect(s.save).not.toHaveBeenCalled();
  });

  it('ignores stale composition after manual editing', async () => {
    const s = setup();
    const result = deferred<{ sentence: string }>();
    vi.spyOn(s.api, 'compose').mockReturnValue(result.promise);
    const composing = s.session.compose(['Old']);
    s.session.edit('Custom spelling');
    result.resolve({ sentence: 'Old' });
    await composing;
    expect(s.session.snapshot().preview).toBe('Custom spelling');
    expect(s.session.snapshot().confirmed).toBe(false);
  });

  it('blocked playback and missing credentials never save', async () => {
    const s = setup();
    vi.mocked(s.speech.prepare).mockRejectedValue(new Error('Speech not configured'));
    s.session.edit('Hello');
    s.session.confirm();
    await s.session.speak();
    expect(s.save).not.toHaveBeenCalled();
    expect(s.session.snapshot().confirmed).toBe(false);
    expect(s.session.snapshot().error).toContain('Speech did not start');
  });

  it('dispose cancels preparation and prevents late playback', async () => {
    const s = setup();
    const ready = deferred<PreparedSpeech>();
    vi.mocked(s.speech.prepare).mockReturnValue(ready.promise);
    s.session.edit('Hello'); s.session.confirm();
    const speaking = s.session.speak();
    s.session.dispose(); ready.resolve(s.audio);
    await speaking;
    expect(s.audio.start).not.toHaveBeenCalled();
  });
});
