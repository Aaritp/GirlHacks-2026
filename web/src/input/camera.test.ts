import { describe, expect, it, vi } from 'vitest';
import { startCamera, type Detector } from './camera';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup() {
  const track = Object.assign(new EventTarget(), { stop: vi.fn() });
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const doc = Object.assign(new EventTarget(), { hidden: false, defaultView: new EventTarget() });
  const video = { ownerDocument: doc, srcObject: null, readyState: 2, currentTime: 1,
    play: vi.fn().mockResolvedValue(undefined), pause: vi.fn() } as unknown as HTMLVideoElement;
  const detector: Detector = { detect: vi.fn(() => ({ hands: [], face: [] })), close: vi.fn() };
  const requestFrame = vi.fn<typeof requestAnimationFrame>(() => 1);
  const options = { video, mode: 'hand' as const, onFrame: vi.fn(), onError: vi.fn(), onStop: vi.fn(),
    requestFrame, cancelFrame: vi.fn(), mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    loadDetector: vi.fn().mockResolvedValue(detector) };
  return { track, stream, doc, detector, options };
}
describe('camera lifecycle', () => {
  it('stops tracks, inference, video and listeners idempotently', async () => {
    const { options, track, detector, doc } = setup();
    const camera = startCamera(options); await camera.ready;
    options.requestFrame.mock.calls[0][0](100);
    expect(detector.detect).toHaveBeenCalledTimes(1);
    options.requestFrame.mock.calls[1][0](200); // Same video frame must not run twice.
    expect(detector.detect).toHaveBeenCalledTimes(1);
    camera.stop(); camera.stop(); doc.dispatchEvent(new Event('visibilitychange'));
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(detector.close).toHaveBeenCalledTimes(1);
    expect(options.video.srcObject).toBeNull();
    expect(options.cancelFrame).toHaveBeenCalled();
    expect(options.onStop).toHaveBeenCalledTimes(1);
  });
  it('stops a stream granted after unmount without loading models', async () => {
    const { options, stream, track } = setup();
    const permission = deferred<MediaStream>(); options.mediaDevices.getUserMedia.mockReturnValue(permission.promise);
    const camera = startCamera(options); camera.stop(); permission.resolve(stream); await camera.ready;
    expect(track.stop).toHaveBeenCalledTimes(1); expect(options.loadDetector).not.toHaveBeenCalled();
  });
  it('closes a detector that finishes loading after stop', async () => {
    const { options, detector, track } = setup(); const model = deferred<Detector>();
    options.loadDetector.mockReturnValue(model.promise);
    const camera = startCamera(options); await Promise.resolve(); camera.stop(); model.resolve(detector); await camera.ready;
    expect(track.stop).toHaveBeenCalledTimes(1); expect(detector.close).toHaveBeenCalledTimes(1);
    expect(options.requestFrame).not.toHaveBeenCalled();
  });
  it('reports denied permission and failed models without retaining camera tracks', async () => {
    for (const stage of ['permission', 'model'] as const) {
      const { options, track } = setup();
      (stage === 'permission' ? options.mediaDevices.getUserMedia : options.loadDetector).mockRejectedValue(new Error('Unavailable'));
      await startCamera(options).ready;
      expect(options.onError).toHaveBeenCalledOnce();
      expect(track.stop).toHaveBeenCalledTimes(stage === 'model' ? 1 : 0);
    }
  });
  it('stops on hidden tabs, ended tracks, and inference errors', async () => {
    for (const reason of ['hidden', 'ended', 'inference'] as const) {
      const { options, doc, track, detector } = setup(); await startCamera(options).ready;
      if (reason === 'hidden') { doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); }
      if (reason === 'ended') track.dispatchEvent(new Event('ended'));
      if (reason === 'inference') {
        vi.mocked(detector.detect).mockImplementation(() => { throw new Error('Inference failed'); });
        options.requestFrame.mock.calls[0][0](100);
      }
      expect(track.stop).toHaveBeenCalledOnce(); expect(detector.close).toHaveBeenCalledOnce();
    }
  });
});
