import { createPcm16Resampler } from './pcm';

/** Online meetings only: a Zoom/Meet/Teams browser tab's audio, plus the user's own mic. */
export type CaptureErrorCode =
  | 'insecure-context' | 'unsupported-browser' | 'share-cancelled' | 'no-tab-audio'
  | 'mic-denied' | 'mic-unavailable' | 'capture-failed';

export const CAPTURE_MESSAGES: Record<CaptureErrorCode, string> = {
  'insecure-context': 'Meeting capture needs a secure page. Open Grovekeeper over https or on localhost.',
  'unsupported-browser': 'Sharing a meeting tab with audio needs Chrome or Edge on a desktop computer. '
    + 'Open Grovekeeper there, with your Zoom, Meet or Teams call in another tab.',
  'share-cancelled': 'Tab sharing was cancelled. Click "Share meeting tab" and pick the tab with your call.',
  'no-tab-audio': 'The share has no audio. Share again, choose the Chrome tab with your call, '
    + 'and keep "Also share tab audio" switched on.',
  'mic-denied': 'Microphone access is blocked, so your own voice cannot be transcribed. Allow the '
    + 'microphone for this site (the icon in the address bar), then share again.',
  'mic-unavailable': 'No usable microphone was found, or another app is using it. Check your mic, then share again.',
  'capture-failed': 'Meeting audio could not be captured. Reload the page and try again.',
};

export class CaptureError extends Error {
  constructor(public readonly code: CaptureErrorCode) {
    super(CAPTURE_MESSAGES[code]);
    this.name = 'CaptureError';
  }
}

export interface CaptureEnvironment {
  mediaDevices?: Pick<MediaDevices, 'getDisplayMedia' | 'getUserMedia'>;
  isSecureContext: boolean;
  /** Chromium-only (User-Agent Client Hints). Absent in Firefox and Safari. */
  userAgentData?: { brands?: { brand: string }[] };
}

export function browserEnvironment(): CaptureEnvironment {
  return {
    mediaDevices: navigator.mediaDevices,
    isSecureContext: window.isSecureContext,
    userAgentData: (navigator as Navigator & { userAgentData?: CaptureEnvironment['userAgentData'] }).userAgentData,
  };
}

/**
 * Only desktop Chromium (Chrome, Edge, Brave, Opera) shares tab audio. Firefox and Safari
 * expose getDisplayMedia but never return tab audio, so they are rejected before the picker.
 */
export function checkTabCaptureSupport(env: CaptureEnvironment): CaptureError | null {
  if (!env.isSecureContext) return new CaptureError('insecure-context');
  if (typeof env.mediaDevices?.getDisplayMedia !== 'function') return new CaptureError('unsupported-browser');
  const chromium = env.userAgentData?.brands?.some(({ brand }) => brand === 'Chromium') ?? false;
  return chromium ? null : new CaptureError('unsupported-browser');
}

// Chrome-only options are missing from the DOM typings.
const DISPLAY_OPTIONS = {
  video: { displaySurface: 'browser' },
  audio: {
    echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    suppressLocalAudioPlayback: false, // the user must keep hearing the call
  },
  preferCurrentTab: false,
  selfBrowserSurface: 'exclude',
  surfaceSwitching: 'include',
  systemAudio: 'include',
} as DisplayMediaStreamOptions;

const MIC_OPTIONS: MediaStreamConstraints = {
  // Echo cancellation keeps the call's audio (already captured from the tab) out of the mic.
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: false,
};

export interface MeetingStreams { tab: MediaStream; mic: MediaStream }

export function stopStream(stream: MediaStream | undefined) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

function errorName(reason: unknown) {
  return typeof reason === 'object' && reason !== null && 'name' in reason ? String(reason.name) : '';
}

/**
 * Asks for the meeting tab first (it must run directly from the click), then the mic.
 * Every failure releases whatever was already granted.
 */
export async function acquireMeetingStreams(env: CaptureEnvironment): Promise<MeetingStreams> {
  const unsupported = checkTabCaptureSupport(env);
  if (unsupported) throw unsupported;
  const devices = env.mediaDevices!;
  let tab: MediaStream;
  try {
    tab = await devices.getDisplayMedia(DISPLAY_OPTIONS);
  } catch (reason) {
    const name = errorName(reason);
    if (name === 'NotAllowedError' || name === 'AbortError') throw new CaptureError('share-cancelled');
    if (name === 'NotSupportedError' || name === 'TypeError') throw new CaptureError('unsupported-browser');
    throw new CaptureError('capture-failed');
  }
  if (!tab.getAudioTracks().some((track) => track.readyState === 'live')) {
    stopStream(tab);
    throw new CaptureError('no-tab-audio');
  }
  try {
    return { tab, mic: await devices.getUserMedia(MIC_OPTIONS) };
  } catch (reason) {
    stopStream(tab);
    const name = errorName(reason);
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new CaptureError('mic-denied');
    if (['NotFoundError', 'NotReadableError', 'OverconstrainedError', 'AbortError'].includes(name)) {
      throw new CaptureError('mic-unavailable');
    }
    throw new CaptureError('capture-failed');
  }
}

export type StreamEndReason = 'share-ended' | 'mic-ended';

/** Reports once when the user stops sharing (any tab track ends) or the mic disconnects. */
export function watchStreamEnd(streams: MeetingStreams, onEnd: (reason: StreamEndReason) => void) {
  let fired = false;
  const listeners: [MediaStreamTrack, () => void][] = [];
  const watch = (track: MediaStreamTrack, reason: StreamEndReason) => {
    const listener = () => {
      if (fired) return;
      fired = true;
      onEnd(reason);
    };
    track.addEventListener('ended', listener);
    listeners.push([track, listener]);
  };
  for (const track of streams.tab.getTracks()) watch(track, 'share-ended');
  for (const track of streams.mic.getAudioTracks()) watch(track, 'mic-ended');
  return () => {
    for (const [track, listener] of listeners) track.removeEventListener('ended', listener);
  };
}

const PROCESSOR = 'grovekeeper-pcm-tap';
// Runs on the audio thread: forwards a mono signal in ~40 ms Float32 chunks.
const WORKLET_SOURCE = `
class PcmTap extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.filled = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      let offset = 0;
      while (offset < channel.length) {
        const n = Math.min(channel.length - offset, this.buffer.length - this.filled);
        this.buffer.set(channel.subarray(offset, offset + n), this.filled);
        this.filled += n;
        offset += n;
        if (this.filled === this.buffer.length) {
          this.port.postMessage(this.buffer.slice(0));
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('${PROCESSOR}', PcmTap);
`;

export interface PcmPipeline { stop(): Promise<void> }

/**
 * The tab carries only the other participants (calls do not play your own voice back) and
 * the mic carries the user, so the two are transcribed separately to label the user by name.
 */
export type AudioChannel = 'tab' | 'mic';

/** Taps tab and mic separately with Web Audio and emits 16 kHz Int16 PCM per channel. Requires a real browser. */
export async function startPcmPipeline(
  streams: MeetingStreams, onPcm: (channel: AudioChannel, pcm: Int16Array) => void,
): Promise<PcmPipeline> {
  const context = new AudioContext({ latencyHint: 'interactive' });
  try {
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    // The graph must reach the destination to be processed; gain 0 keeps the mic off the speakers.
    const mute = context.createGain();
    mute.gain.value = 0;
    mute.connect(context.destination);
    const nodes: AudioNode[] = [mute];
    const tap = (channel: AudioChannel, stream: MediaStream) => {
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, PROCESSOR, {
        numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1,
        channelCountMode: 'explicit', channelInterpretation: 'speakers',
      });
      const resample = createPcm16Resampler(context.sampleRate);
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const pcm = resample(event.data);
        if (pcm.length) onPcm(channel, pcm);
      };
      source.connect(node).connect(mute);
      nodes.push(source, node);
      return node;
    };
    const taps = [tap('tab', new MediaStream(streams.tab.getAudioTracks())), tap('mic', streams.mic)];
    await context.resume();
    return {
      async stop() {
        for (const node of taps) node.port.onmessage = null;
        for (const node of nodes) node.disconnect();
        if (context.state !== 'closed') await context.close();
      },
    };
  } catch (reason) {
    if (context.state !== 'closed') await context.close();
    throw reason;
  }
}
