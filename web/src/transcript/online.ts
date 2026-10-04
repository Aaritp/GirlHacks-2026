import type { GroveApi } from '../api/contracts';
import {
  acquireMeetingStreams, browserEnvironment, startPcmPipeline, stopStream, watchStreamEnd,
  type AudioChannel, type CaptureEnvironment, type MeetingStreams, type PcmPipeline,
} from './capture';
import { SPEECH_SAMPLE_RATE } from './pcm';
import type { FinalSegment } from './session';
import { startPushTranscriber, type PushTranscriber } from './speech';

export type SessionEndReason = 'stopped' | 'share-ended' | 'mic-ended' | 'speech-error';

export interface OnlineCaptureCallbacks {
  /** Live text per channel; the tab and mic can be mid-phrase at the same time. */
  onPartial(channel: AudioChannel, text: string, speaker: string): void;
  onFinal(channel: AudioChannel, segment: FinalSegment): void;
  onWarning(message: string): void;
  /** Called once, after capture and Speech are released. Not called if start() throws. */
  onEnded(reason: SessionEndReason, message: string | null): void;
}

export interface OnlineCaptureOptions {
  /** The user's display name: every phrase from their mic is labelled with it. */
  userName: string;
  baseSec?: number;
  language?: string;
  isMicrophoneMuted?: () => boolean;
}

export interface OnlineCaptureDeps {
  env?: CaptureEnvironment;
  acquire?: (env: CaptureEnvironment) => Promise<MeetingStreams>;
  startPipeline?: (streams: MeetingStreams, onPcm: (channel: AudioChannel, pcm: Int16Array) => void) => Promise<PcmPipeline>;
  startTranscriber?: typeof startPushTranscriber;
}

export interface OnlineCapture { stop(): Promise<void>; setMicrophoneMuted?(muted: boolean): void }

/** Audio captured while Speech starts is held, up to this much per channel, then written. */
const MAX_BUFFERED_SAMPLES = SPEECH_SAMPLE_RATE * 15;
const CHANNELS: AudioChannel[] = ['tab', 'mic'];

export function endMessage(reason: SessionEndReason, detail?: string): string | null {
  switch (reason) {
    case 'stopped': return null;
    case 'share-ended': return 'You stopped sharing the meeting tab, so transcription ended.';
    case 'mic-ended': return 'Your microphone disconnected, so transcription ended. Reconnect it and share again.';
    case 'speech-error': return `${detail ?? 'Speech stopped unexpectedly.'} Share the meeting tab again to continue.`;
  }
}

/**
 * Captures a meeting tab plus the user's mic and transcribes them separately: the tab with
 * diarized labels for the other participants, the mic labelled with the user's name.
 * Call from a click handler: the tab picker requires a user gesture.
 */
export async function startOnlineCapture(
  api: Pick<GroveApi, 'getSpeechToken'>, callbacks: OnlineCaptureCallbacks,
  { userName, baseSec = 0, language = 'en-US', isMicrophoneMuted = () => false }: OnlineCaptureOptions, deps: OnlineCaptureDeps = {},
): Promise<OnlineCapture> {
  const name = userName.trim();
  if (!name) throw new Error('Enter your name first so your own lines are labelled.');
  const {
    env = browserEnvironment(), acquire = acquireMeetingStreams,
    startPipeline = startPcmPipeline, startTranscriber = startPushTranscriber,
  } = deps;

  const streams = await acquire(env);
  let microphoneMuted = isMicrophoneMuted();
  const setMicrophoneMuted = (muted: boolean) => {
    microphoneMuted = muted;
    streams.mic.getAudioTracks().forEach((track) => { track.enabled = !muted; });
  };
  setMicrophoneMuted(microphoneMuted);
  const transcribers: Partial<Record<AudioChannel, PushTranscriber>> = {};
  const buffered: Record<AudioChannel, Int16Array[]> = { tab: [], mic: [] };
  const bufferedSamples: Record<AudioChannel, number> = { tab: 0, mic: 0 };
  let pipeline: PcmPipeline | null = null;
  let ending: Promise<void> | null = null;
  let started = false;

  const write = (channel: AudioChannel, pcm: Int16Array) => {
    // Silence retains sample count/timestamps without sending question audio to the
    // meeting recognizer, including while its credentials are still loading.
    if (channel === 'mic' && (microphoneMuted || isMicrophoneMuted())) pcm = new Int16Array(pcm.length);
    const ready = transcribers[channel];
    if (started && ready) { ready.write(pcm); return; }
    const queue = buffered[channel];
    queue.push(pcm);
    bufferedSamples[channel] += pcm.length;
    while (bufferedSamples[channel] > MAX_BUFFERED_SAMPLES && queue.length > 1) {
      bufferedSamples[channel] -= queue.shift()!.length;
    }
  };

  const release = async () => {
    unwatch();
    await pipeline?.stop().catch(() => undefined);
    stopStream(streams.tab);
    stopStream(streams.mic);
    // Closing the push streams after the audio stops lets Speech finalize the last phrases.
    await Promise.all(CHANNELS.map((channel) => transcribers[channel]?.stop().catch(() => undefined)));
  };

  const end = (reason: SessionEndReason, detail?: string): Promise<void> => {
    ending ??= (async () => {
      await release();
      // A share stopped during startup is reported by start() rejecting, not by onEnded.
      if (started) callbacks.onEnded(reason, endMessage(reason, detail));
    })();
    return ending;
  };

  const unwatch = watchStreamEnd(streams, (reason) => { void end(reason); });

  try {
    pipeline = await startPipeline(streams, write);
    if (ending) throw new Error('ended');
    const start = (channel: AudioChannel) => startTranscriber(api, {
      onPartial: (text, speaker) => callbacks.onPartial(channel, text, speaker),
      onFinal: (segment) => callbacks.onFinal(channel, segment),
      onWarning: callbacks.onWarning,
      onCanceled: (message) => { void end('speech-error', message); },
    }, { baseSec, language, speaker: channel === 'mic' ? name : undefined }).then((ready) => {
      transcribers[channel] = ready;
      return ready;
    });
    // Start both even if one fails, so a started one is never left running unreleased.
    const results = await Promise.allSettled(CHANNELS.map(start));
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw (failure as PromiseRejectedResult).reason;
    if (ending) throw new Error('ended');
    for (const channel of CHANNELS) {
      for (const pcm of buffered[channel]) transcribers[channel]!.write(pcm);
      buffered[channel] = [];
      bufferedSamples[channel] = 0;
    }
    started = true;
  } catch (reason) {
    await end('stopped');
    // A transcriber that finished starting after release() ran is still live; stop() is idempotent.
    await Promise.all(CHANNELS.map((channel) => transcribers[channel]?.stop().catch(() => undefined)));
    if (reason instanceof Error && reason.message === 'ended') {
      throw new Error('Sharing stopped before transcription started. Share the meeting tab again.');
    }
    throw reason;
  }

  return { stop: () => end('stopped'), setMicrophoneMuted };
}
