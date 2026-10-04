import type { GroveApi } from '../api/contracts';
import type { PreparedSpeech, SpeechOutput } from './session';

function waitForCredentials<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => finish(new DOMException('Speech canceled', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Speech token request timed out.')), 15000);
    let settled = false;
    function finish(error?: Error, value?: T) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve(value!);
    }
    signal.addEventListener('abort', cancel, { once: true });
    operation.then((value) => finish(undefined, value),
      () => finish(new Error('Speech credentials are unavailable. Check the service configuration.')));
    if (signal.aborted) cancel();
  });
}

/** Synthesize to a buffer, never to the SDK's default speaker. Playback is explicit. */
export function azureSpeechOutput(api: Pick<GroveApi, 'getSpeechToken'>): SpeechOutput {
  return {
    async prepare(text, signal) {
      const [sdk, credentials] = await waitForCredentials(Promise.all([
        import('microsoft-cognitiveservices-speech-sdk'), api.getSpeechToken(),
      ]), signal);
      signal.throwIfAborted();
      const config = sdk.SpeechConfig.fromAuthorizationToken(credentials.token, credentials.region);
      config.speechSynthesisVoiceName = 'en-US-JennyNeural';
      config.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
      const synthesizer = new sdk.SpeechSynthesizer(config, null);
      const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error, data?: ArrayBuffer) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', cancel);
          clearTimeout(timer);
          synthesizer.close();
          if (error) reject(error); else resolve(data!);
        };
        const cancel = () => finish(new DOMException('Speech canceled', 'AbortError'));
        const timer = setTimeout(() => finish(new Error('Azure Speech timed out.')), 45000);
        signal.addEventListener('abort', cancel, { once: true });
        try {
          synthesizer.speakTextAsync(text, (result) => {
            if (result.reason !== sdk.ResultReason.SynthesizingAudioCompleted || !result.audioData.byteLength) {
              finish(new Error('Azure Speech could not synthesize this preview.'));
            } else finish(undefined, result.audioData);
          }, () => finish(new Error('Azure Speech synthesis failed.')));
        } catch {
          finish(new Error('Azure Speech synthesis failed.'));
        }
      });
      signal.throwIfAborted();
      return bufferedSpeech(bytes, signal);
    },
  };
}

export function bufferedSpeech(bytes: ArrayBuffer, signal: AbortSignal): PreparedSpeech {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
  const audio = new Audio(url);
  let rejectPlayback: ((reason: Error) => void) | undefined;
  let closed = false;
  let used = false;
  const cancel = () => {
    if (closed) return;
    closed = true;
    audio.onplaying = null;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    URL.revokeObjectURL(url);
    signal.removeEventListener('abort', cancel);
    rejectPlayback?.(new DOMException('Speech canceled', 'AbortError'));
  };
  signal.addEventListener('abort', cancel, { once: true });
  return {
    start(onStarted) {
      if (closed || used || signal.aborted) return Promise.reject(new Error('Confirm again before speaking.'));
      used = true;
      return new Promise<void>((resolve, reject) => {
        rejectPlayback = reject;
        let started = false;
        audio.onplaying = () => {
          if (!started && !closed && !signal.aborted) { started = true; onStarted(); }
        };
        audio.onended = () => { rejectPlayback = undefined; resolve(); cancel(); };
        audio.onerror = () => { reject(new Error('Audio playback failed.')); cancel(); };
        audio.play().catch(() => {
          reject(new Error('The browser blocked audio. Activate Speak with the keyboard or mouse, or enable audio for this site.'));
          cancel();
        });
      });
    },
    cancel,
  };
}
