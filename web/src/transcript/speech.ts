import type { GroveApi } from '../api/contracts';
import type { FinalSegment } from './session';

export interface LiveTranscriberCallbacks {
  onPartial(text: string, speaker: string): void;
  onFinal(segment: FinalSegment): void;
  onError(message: string): void;
}

export interface LiveTranscriber { stop(): Promise<void> }

/** Tokens last 10 minutes; refresh well before expiry. */
const TOKEN_REFRESH_MS = 9 * 60 * 1000;
const TICKS_PER_SECOND = 10_000_000;

export function speakerLabel(speakerId: string | undefined) {
  return !speakerId || speakerId.toLowerCase() === 'unknown' ? 'Unknown speaker' : speakerId;
}

/**
 * Streams the default microphone to Azure Speech with speaker diarization.
 * Only a short-lived token from our backend reaches the browser; never a key.
 * `baseSec` offsets results so restarts continue the meeting clock.
 */
export async function startLiveTranscriber(
  api: Pick<GroveApi, 'getSpeechToken'>, callbacks: LiveTranscriberCallbacks,
  { baseSec = 0, language = 'en-US' } = {},
): Promise<LiveTranscriber> {
  const [sdk, credentials] = await Promise.all([
    import('microsoft-cognitiveservices-speech-sdk'), api.getSpeechToken(),
  ]);
  const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(credentials.token, credentials.region);
  speechConfig.speechRecognitionLanguage = language;
  const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
  const transcriber = new sdk.ConversationTranscriber(speechConfig, audioConfig);
  const seconds = (offset: number) => baseSec + offset / TICKS_PER_SECOND;

  transcriber.transcribing = (_sender, event) => {
    callbacks.onPartial(event.result.text, speakerLabel(event.result.speakerId));
  };
  transcriber.transcribed = (_sender, event) => {
    if (event.result.reason !== sdk.ResultReason.RecognizedSpeech || !event.result.text.trim()) return;
    callbacks.onFinal({
      speaker: speakerLabel(event.result.speakerId), text: event.result.text,
      startSec: seconds(event.result.offset), via: 'voice',
    });
  };
  transcriber.canceled = (_sender, event) => {
    if (event.reason === sdk.CancellationReason.Error) {
      callbacks.onError(`Speech stopped: ${event.errorDetails || 'connection error'}`);
    }
  };

  const refresh = setInterval(() => {
    api.getSpeechToken().then(
      ({ token }) => { transcriber.authorizationToken = token; },
      (reason: unknown) => callbacks.onError(
        `Speech token refresh failed: ${reason instanceof Error ? reason.message : 'unknown error'}`),
    );
  }, TOKEN_REFRESH_MS);

  const dispose = () => {
    clearInterval(refresh);
    transcriber.close();
    audioConfig.close();
  };

  try {
    await new Promise<void>((resolve, reject) => transcriber.startTranscribingAsync(resolve, reject));
  } catch (reason) {
    dispose();
    throw new Error(`Could not start transcription: ${String(reason)}`);
  }

  return {
    stop: () => new Promise<void>((resolve) => {
      // Stopping still delivers the last finalized phrase before resolving.
      transcriber.stopTranscribingAsync(() => { dispose(); resolve(); }, () => { dispose(); resolve(); });
    }),
  };
}
