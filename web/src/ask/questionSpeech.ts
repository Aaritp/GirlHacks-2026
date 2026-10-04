import type { GroveApi } from '../api/contracts';

export interface QuestionRecognition { stop(): Promise<void>; cancel(): void }
export interface QuestionCallbacks { onPartial(text: string): void; onFinal(text: string): void; onError(message: string): void }
export type QuestionRecognizer = (api: Pick<GroveApi, 'getSpeechToken'>, callbacks: QuestionCallbacks,
  signal: AbortSignal) => Promise<QuestionRecognition>;

/** A separate microphone recognizer. It never saves an utterance, extracts a seed or plays audio. */
export const startQuestionRecognition: QuestionRecognizer = async (api, callbacks, signal) => {
  const aborted = () => { if (signal.aborted) throw new DOMException('Question canceled', 'AbortError'); };
  aborted();
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Voice questions need microphone access in a secure browser. You can type instead.');
  const [sdk, token] = await Promise.all([import('microsoft-cognitiveservices-speech-sdk'), api.getSpeechToken()]);
  aborted();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true }, video: false });
  let audio: InstanceType<typeof sdk.AudioConfig> | undefined;
  let recognizer: InstanceType<typeof sdk.SpeechRecognizer> | undefined;
  let closed = false;
  let finishTask: Promise<void> | undefined;
  const cancel = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener('abort', cancel);
    stream.getTracks().forEach((track) => track.stop());
    try { recognizer?.close(); } finally { audio?.close(); }
  };
  try {
    aborted();
    signal.addEventListener('abort', cancel, { once: true });
    const config = sdk.SpeechConfig.fromAuthorizationToken(token.token, token.region);
    config.speechRecognitionLanguage = 'en-US';
    audio = sdk.AudioConfig.fromStreamInput(stream);
    recognizer = new sdk.SpeechRecognizer(config, audio);
    recognizer.recognizing = (_, event) => { if (!closed) callbacks.onPartial(event.result.text); };
    recognizer.recognized = (_, event) => {
      if (!closed && event.result.reason === sdk.ResultReason.RecognizedSpeech && event.result.text.trim()) callbacks.onFinal(event.result.text);
    };
    recognizer.canceled = () => {
      if (!closed) callbacks.onError('Question recognition stopped. Check Speech configuration or type your question.');
      cancel();
    };
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timeout); signal.removeEventListener('abort', onAbort); };
      const onAbort = () => { cleanup(); reject(new DOMException('Question canceled', 'AbortError')); };
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Starting the microphone timed out. Please try again.')); }, 15000);
      signal.addEventListener('abort', onAbort, { once: true });
      recognizer!.startContinuousRecognitionAsync(() => { cleanup(); resolve(); }, () => {
        cleanup(); reject(new Error('Could not start question recognition. You can type instead.'));
      });
    });
    aborted();
    if (closed) throw new Error('Question recognition ended before it was ready.');
    return {
      cancel,
      stop() {
        if (finishTask) return finishTask;
        if (closed) return Promise.resolve();
        // Stop audio collection immediately; allow the recognizer to finalize buffered words.
        stream.getTracks().forEach((track) => track.stop());
        finishTask = new Promise<void>((resolve) => {
          const done = () => { clearTimeout(timer); cancel(); resolve(); };
          const timer = setTimeout(done, 2000);
          try { recognizer!.stopContinuousRecognitionAsync(done, done); } catch { done(); }
        });
        return finishTask;
      },
    };
  } catch (reason) { cancel(); throw reason; }
};
