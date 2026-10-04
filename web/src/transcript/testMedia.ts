/** Minimal MediaStream/Track stand-ins for Node tests (no DOM in this Vitest setup). */
import type { CaptureEnvironment, MeetingStreams } from './capture';

export class FakeTrack {
  readyState: MediaStreamTrackState = 'live';
  private listeners = new Set<() => void>();
  constructor(public kind: 'audio' | 'video') {}
  stop() { this.readyState = 'ended'; }
  addEventListener(_type: 'ended', listener: () => void) { this.listeners.add(listener); }
  removeEventListener(_type: 'ended', listener: () => void) { this.listeners.delete(listener); }
  /** What the browser does when the user clicks "Stop sharing" or unplugs the mic. */
  end() {
    this.readyState = 'ended';
    for (const listener of [...this.listeners]) listener();
  }
  get listenerCount() { return this.listeners.size; }
}

export class FakeStream {
  constructor(public tracks: FakeTrack[]) {}
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio'); }
  get allStopped() { return this.tracks.every((track) => track.readyState === 'ended'); }
}

export const asStream = (stream: FakeStream) => stream as unknown as MediaStream;

export function meetingStreams(tabTracks: FakeTrack[] = [new FakeTrack('video'), new FakeTrack('audio')]) {
  const tab = new FakeStream(tabTracks);
  const mic = new FakeStream([new FakeTrack('audio')]);
  return { tab, mic, streams: { tab: asStream(tab), mic: asStream(mic) } as MeetingStreams };
}

export function domError(name: string) {
  return Object.assign(new Error(name), { name });
}

export function chromeEnv(mediaDevices: Partial<CaptureEnvironment['mediaDevices']> = {}): CaptureEnvironment {
  return {
    isSecureContext: true,
    userAgentData: { brands: [{ brand: 'Google Chrome' }, { brand: 'Chromium' }] },
    mediaDevices: {
      getDisplayMedia: async () => asStream(meetingStreams().tab),
      getUserMedia: async () => asStream(meetingStreams().mic),
      ...mediaDevices,
    } as CaptureEnvironment['mediaDevices'],
  };
}
