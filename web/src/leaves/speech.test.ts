import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { azureSpeechOutput, bufferedSpeech } from './speech';

class FakeAudio {
  static current: FakeAudio;
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {});
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
  constructor(_url: string) { FakeAudio.current = this; }
}
beforeEach(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('preparation is silent; only actual playing reports speech initiation once', async () => {
  const signal = new AbortController().signal;
  const speech = bufferedSpeech(new ArrayBuffer(4), signal);
  const audio = FakeAudio.current;
  const started = vi.fn();
  expect(audio.play).not.toHaveBeenCalled();
  const completion = speech.start(started);
  expect(started).not.toHaveBeenCalled();
  audio.onplaying!(); audio.onplaying!();
  expect(started).toHaveBeenCalledOnce();
  audio.onended!();
  await completion;
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
});

it('autoplay rejection does not report a spoken contribution', async () => {
  const speech = bufferedSpeech(new ArrayBuffer(4), new AbortController().signal);
  FakeAudio.current.play.mockRejectedValue(new Error('NotAllowedError'));
  const started = vi.fn();
  await expect(speech.start(started)).rejects.toThrow('browser blocked audio');
  expect(started).not.toHaveBeenCalled();
});

it('an edit abort stops playback and late events cannot record speech', async () => {
  const abort = new AbortController();
  const speech = bufferedSpeech(new ArrayBuffer(4), abort.signal);
  const started = vi.fn();
  const playback = speech.start(started);
  const failure = expect(playback).rejects.toThrow('Speech canceled');
  abort.abort();
  await failure;
  expect(FakeAudio.current.onplaying).toBeNull();
  expect(FakeAudio.current.pause).toHaveBeenCalledOnce();
  expect(started).not.toHaveBeenCalled();
});

it('cancel releases a stalled credential request without starting audio', async () => {
  const abort = new AbortController();
  const output = azureSpeechOutput({ getSpeechToken: () => new Promise(() => {}) });
  const preparation = output.prepare('Confirmed text', abort.signal);
  const failure = expect(preparation).rejects.toThrow('Speech canceled');
  abort.abort();
  await failure;
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
