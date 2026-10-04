// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startQuestionRecognition } from './questionSpeech';

const fake = vi.hoisted(() => ({ token: vi.fn(), stream: vi.fn(), mic: vi.fn(), stop: vi.fn(),
  close: vi.fn(), audioClose: vi.fn(), start: vi.fn(), instance: null as any }));
vi.mock('microsoft-cognitiveservices-speech-sdk', () => ({
  SpeechConfig: { fromAuthorizationToken: fake.token },
  AudioConfig: { fromStreamInput: fake.stream },
  ResultReason: { RecognizedSpeech: 3 },
  SpeechRecognizer: class {
    recognizing?: Function; recognized?: Function; canceled?: Function;
    constructor() { fake.instance = this; }
    startContinuousRecognitionAsync(done: () => void) { fake.start(); done(); }
    stopContinuousRecognitionAsync(done: () => void) {
      this.recognized?.(this, { result: { reason: 3, text: 'Final words' } }); done();
    }
    close() { fake.close(); }
  },
}));
beforeEach(() => {
  vi.clearAllMocks(); fake.instance = null;
  fake.token.mockReturnValue({}); fake.stream.mockReturnValue({ close: fake.audioClose });
  fake.mic.mockResolvedValue({ getTracks: () => [{ stop: fake.stop }] });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: fake.mic } });
});
afterEach(() => vi.unstubAllGlobals());
const api = { getSpeechToken: async () => ({ token: 'short-lived', region: 'region' }) };
const callbacks = () => ({ onFinal: vi.fn(), onPartial: vi.fn(), onError: vi.fn() });

it('uses a backend token and separate mic stream, finalizes on release and closes resources', async () => {
  const events = callbacks();
  const recorder = await startQuestionRecognition(api, events, new AbortController().signal);
  expect(fake.token).toHaveBeenCalledWith('short-lived', 'region'); expect(fake.start).toHaveBeenCalledOnce();
  await recorder.stop();
  expect(events.onFinal).toHaveBeenCalledWith('Final words');
  expect(fake.stop).toHaveBeenCalled(); expect(fake.close).toHaveBeenCalledOnce(); expect(fake.audioClose).toHaveBeenCalledOnce();
  fake.instance.recognized(fake.instance, { result: { reason: 3, text: 'Late words' } });
  expect(events.onFinal).toHaveBeenCalledOnce();
});

it('stops a stream whose microphone permission arrives after cancellation', async () => {
  let resolve!: (stream: unknown) => void;
  fake.mic.mockImplementation(() => new Promise((done) => { resolve = done; }));
  const abort = new AbortController();
  const pending = startQuestionRecognition(api, callbacks(), abort.signal);
  const failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(fake.mic).toHaveBeenCalled());
  abort.abort(); resolve({ getTracks: () => [{ stop: fake.stop }] });
  await failure; expect(fake.stop).toHaveBeenCalledOnce(); expect(fake.start).not.toHaveBeenCalled();
});

it('never opens the microphone after a canceled credential request', async () => {
  let resolve!: (token: { token: string; region: string }) => void;
  const abort = new AbortController();
  const pending = startQuestionRecognition({ getSpeechToken: () => new Promise((done) => { resolve = done; }) }, callbacks(), abort.signal);
  const failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  abort.abort(); resolve({ token: 'late', region: 'region' });
  await failure; expect(fake.mic).not.toHaveBeenCalled();
});

it('cancellation stops the mic immediately and ignores late recognition', async () => {
  const abort = new AbortController(); const events = callbacks();
  await startQuestionRecognition(api, events, abort.signal); abort.abort();
  expect(fake.stop).toHaveBeenCalledOnce(); expect(fake.close).toHaveBeenCalledOnce();
  fake.instance.recognized(fake.instance, { result: { reason: 3, text: 'Private question' } });
  expect(events.onFinal).not.toHaveBeenCalled();
});
