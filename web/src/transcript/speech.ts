import type { GroveApi } from '../api/contracts';
import { SPEECH_SAMPLE_RATE } from './pcm';
import type { FinalSegment } from './session';

export interface LiveTranscriberCallbacks {
  onPartial(text: string, speaker: string): void;
  onFinal(segment: FinalSegment): void;
  /** Azure ended the session (network, auth, quota). The transcriber is no longer running. */
  onCanceled(message: string): void;
  /** Non-fatal problem, e.g. a token refresh failed; the session continues until the token expires. */
  onWarning(message: string): void;
}

export interface PushTranscriber {
  /** Writes 16 kHz, 16-bit mono PCM. */
  write(pcm: Int16Array): void;
  /** Ends the audio, waits briefly for the last phrase to finalize, then releases the SDK. */
  stop(): Promise<void>;
}

/** Tokens last 10 minutes; refresh well before expiry, and retry quickly if a refresh fails. */
export const TOKEN_REFRESH_MS = 9 * 60 * 1000;
export const TOKEN_RETRY_MS = 30 * 1000;
const TICKS_PER_SECOND = 10_000_000;
const FINALIZE_TIMEOUT_MS = 3000;

export function speakerLabel(speakerId: string | undefined) {
  return !speakerId || speakerId.toLowerCase() === 'unknown' ? 'Unknown speaker' : speakerId;
}

/**
 * Refreshes the Speech token every 9 minutes. A failed refresh warns once and retries
 * every 30 seconds, so one network blip does not end the session when the token expires.
 * Returns a cancel function.
 */
export function scheduleTokenRefresh(
  fetchToken: () => Promise<string>, apply: (token: string) => void, onWarning: (message: string) => void,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  let failing = false;
  const run = () => {
    fetchToken().then((token) => {
      if (cancelled) return;
      apply(token);
      failing = false;
      timer = setTimeout(run, TOKEN_REFRESH_MS);
    }, (reason: unknown) => {
      if (cancelled) return;
      if (!failing) {
        onWarning(`Speech token refresh failed (${reason instanceof Error ? reason.message : 'unknown error'}); retrying.`);
      }
      failing = true;
      timer = setTimeout(run, TOKEN_RETRY_MS);
    });
  };
  timer = setTimeout(run, TOKEN_REFRESH_MS);
  return () => { cancelled = true; clearTimeout(timer); };
}

export interface PushTranscriberOptions {
  baseSec?: number;
  language?: string;
  /**
   * Fixed label for a single known speaker (the user's own mic): plain recognition, no
   * diarization. Omit for meeting audio to get diarized labels (Guest-1, Guest-2, ...).
   */
  speaker?: string;
}

/**
 * Transcribes pushed PCM with Azure Speech. Only a short-lived token from our backend
 * reaches the browser; never a key. `baseSec` offsets results so restarts continue the
 * meeting clock.
 */
export async function startPushTranscriber(
  api: Pick<GroveApi, 'getSpeechToken'>, callbacks: LiveTranscriberCallbacks,
  { baseSec = 0, language = 'en-US', speaker }: PushTranscriberOptions = {},
): Promise<PushTranscriber> {
  const [sdk, credentials] = await Promise.all([
    import('microsoft-cognitiveservices-speech-sdk'), api.getSpeechToken(),
  ]);
  const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(credentials.token, credentials.region);
  speechConfig.speechRecognitionLanguage = language;
  const pushStream = sdk.AudioInputStream.createPushStream(
    sdk.AudioStreamFormat.getWaveFormatPCM(SPEECH_SAMPLE_RATE, 16, 1));
  const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
  const seconds = (offset: number) => baseSec + offset / TICKS_PER_SECOND;
  let stopping = false;
  let markStopped!: () => void;
  const sessionStopped = new Promise<void>((resolve) => { markStopped = resolve; });
  const final = (result: { reason: number; text: string; offset: number }, label: string) => {
    if (result.reason !== sdk.ResultReason.RecognizedSpeech || !result.text.trim()) return;
    callbacks.onFinal({ speaker: label, text: result.text, startSec: seconds(result.offset), via: 'voice' });
  };

  let transcriber: InstanceType<typeof sdk.SpeechRecognizer> | InstanceType<typeof sdk.ConversationTranscriber>;
  let start: (done: () => void, fail: (error: string) => void) => void;
  let finish: (done: () => void, fail: (error: string) => void) => void;
  if (speaker) {
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    recognizer.recognizing = (_sender, event) => callbacks.onPartial(event.result.text, speaker);
    recognizer.recognized = (_sender, event) => final(event.result, speaker);
    start = (done, fail) => recognizer.startContinuousRecognitionAsync(done, fail);
    finish = (done, fail) => recognizer.stopContinuousRecognitionAsync(done, fail);
    transcriber = recognizer;
  } else {
    const diarizer = new sdk.ConversationTranscriber(speechConfig, audioConfig);
    diarizer.transcribing = (_sender, event) => {
      callbacks.onPartial(event.result.text, speakerLabel(event.result.speakerId));
    };
    diarizer.transcribed = (_sender, event) => final(event.result, speakerLabel(event.result.speakerId));
    start = (done, fail) => diarizer.startTranscribingAsync(done, fail);
    finish = (done, fail) => diarizer.stopTranscribingAsync(done, fail);
    transcriber = diarizer;
  }

  transcriber.sessionStopped = () => markStopped();
  transcriber.canceled = (_sender, event) => {
    markStopped();
    // EndOfStream is the normal result of closing the push stream.
    if (!stopping && event.reason === sdk.CancellationReason.Error) {
      callbacks.onCanceled(`Speech stopped: ${event.errorDetails || 'connection error'}`);
    }
  };

  const cancelRefresh = scheduleTokenRefresh(
    async () => (await api.getSpeechToken()).token,
    (token) => { transcriber.authorizationToken = token; },
    callbacks.onWarning,
  );

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    cancelRefresh();
    transcriber.close();
    audioConfig.close();
  };

  try {
    await new Promise<void>((resolve, reject) => start(resolve, reject));
  } catch (reason) {
    pushStream.close();
    release();
    throw new Error(`Could not start transcription: ${String(reason)}`);
  }

  return {
    write(pcm) {
      if (stopping || !pcm.length) return;
      pushStream.write(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer);
    },
    async stop() {
      if (stopping) return;
      stopping = true;
      pushStream.close();
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([sessionStopped, new Promise<void>((resolve) => { timer = setTimeout(resolve, FINALIZE_TIMEOUT_MS); })]);
      clearTimeout(timer);
      await new Promise<void>((resolve) => finish(resolve, () => resolve()));
      release();
    },
  };
}
