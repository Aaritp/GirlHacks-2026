import type { HandSample } from './hands';
import type { Landmark } from './tracking';

export type CameraMode = 'hand' | 'head';
export interface CameraFrame { hands: HandSample[]; face: Landmark[] }
export interface Detector {
  detect(video: HTMLVideoElement, now: number): CameraFrame;
  close(): void;
}
export interface CameraAssets { wasm: string; handModel: string; faceModel: string }
/** MediaPipe handedness assumes selfie-mirrored input. detectForVideo receives
 * unmirrored camera pixels here, so swap labels (CSS mirroring would not do this).
 * https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/hands.md#multi_handedness
 */
export function cameraHandId(label?: string): string {
  return label === 'Left' ? 'Right' : label === 'Right' ? 'Left' : 'Unknown';
}
export const defaultCameraAssets: CameraAssets = {
  wasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm',
  handModel: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  faceModel: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
};

/** Only model/WASM assets are downloaded. Video and results never leave this browser. */
export async function createDetector(mode: CameraMode, assets = defaultCameraAssets): Promise<Detector> {
  const { FilesetResolver, HandLandmarker, FaceLandmarker } = await import('@mediapipe/tasks-vision');
  const files = await FilesetResolver.forVisionTasks(assets.wasm);
  if (mode === 'hand') {
    const task = await HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: assets.handModel }, runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: 0.7, minHandPresenceConfidence: 0.7, minTrackingConfidence: 0.7,
    });
    return {
      detect(video, now) {
        const result = task.detectForVideo(video, now);
        return { face: [], hands: result.landmarks.map((landmarks, i) => ({
          id: cameraHandId(result.handedness[i]?.[0]?.categoryName), landmarks,
        })) };
      },
      close: () => task.close(),
    };
  }
  const task = await FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: assets.faceModel }, runningMode: 'VIDEO', numFaces: 1,
    minFaceDetectionConfidence: 0.7, minFacePresenceConfidence: 0.7, minTrackingConfidence: 0.7,
  });
  return { detect: (video, now) => ({ hands: [], face: task.detectForVideo(video, now).faceLandmarks[0] ?? [] }),
    close: () => task.close() };
}

export interface CameraOptions {
  video: HTMLVideoElement;
  mode: CameraMode;
  onFrame: (frame: CameraFrame, now: number) => void;
  onError: (error: Error) => void;
  onStop?: () => void;
  assets?: CameraAssets;
  /** Dependency injection for lifecycle tests. */
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'>;
  loadDetector?: (mode: CameraMode, assets?: CameraAssets) => Promise<Detector>;
  requestFrame?: typeof requestAnimationFrame;
  cancelFrame?: typeof cancelAnimationFrame;
}

/** Stop is available immediately, including during a pending browser permission prompt. */
export function startCamera(options: CameraOptions) {
  const { video } = options;
  const doc = video.ownerDocument;
  const request = options.requestFrame ?? requestAnimationFrame;
  const cancel = options.cancelFrame ?? cancelAnimationFrame;
  let stopped = false;
  let stream: MediaStream | undefined;
  let detector: Detector | undefined;
  let frameId: number | undefined;
  let lastVideoTime = -1;
  let lastDetection = -Infinity;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (frameId !== undefined) cancel(frameId);
    doc.removeEventListener('visibilitychange', visibility);
    doc.defaultView?.removeEventListener('pagehide', stop);
    stream?.getTracks().forEach((track) => { track.removeEventListener('ended', stop); track.stop(); });
    detector?.close();
    video.pause(); video.srcObject = null;
    options.onStop?.();
  };
  const visibility = () => { if (doc.hidden) stop(); };
  const fail = (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error('Camera tracking failed');
    stop(); options.onError(error);
  };
  const loop = (now: number) => {
    if (stopped) return;
    try {
      // Synchronous MediaPipe inference is limited to 20 fps and new video frames.
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime && now - lastDetection >= 50) {
        lastVideoTime = video.currentTime; lastDetection = now;
        options.onFrame(detector!.detect(video, now), now);
      }
      if (!stopped) frameId = request(loop);
    } catch (reason) { fail(reason); }
  };
  doc.addEventListener('visibilitychange', visibility);
  doc.defaultView?.addEventListener('pagehide', stop);
  const ready = (async () => {
    try {
      const devices = options.mediaDevices ?? navigator.mediaDevices;
      if (!devices) throw new Error('Camera requires HTTPS or localhost and browser camera support.');
      const acquired = await devices.getUserMedia({ audio: false, video: { facingMode: 'user', width: 640, height: 480 } });
      if (stopped) { acquired.getTracks().forEach((track) => track.stop()); return; }
      stream = acquired;
      stream.getTracks().forEach((track) => track.addEventListener('ended', stop));
      const loaded = await (options.loadDetector ?? createDetector)(options.mode, options.assets);
      if (stopped) { loaded.close(); return; }
      detector = loaded;
      video.muted = true; video.playsInline = true; video.srcObject = stream;
      await video.play();
      if (stopped) return;
      frameId = request(loop);
    } catch (reason) { if (!stopped) fail(reason); }
  })();
  return { stop, ready };
}
