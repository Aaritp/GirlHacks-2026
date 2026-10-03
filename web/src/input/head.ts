import { clamp, distance, median, TrackedCursor, valid, type CursorOptions, type Landmark, type Point } from './tracking';

/** Average eye corners/nose bridge, then remove face translation, scale and roll.
 * Single nose-tip measurements amplify model noise and facial expressions.
 */
function headPose(landmarks: readonly Landmark[]): Point | null {
  const mean = (ids: number[]): Point | null => {
    const points = ids.map((id) => landmarks[id]);
    if (!points.every(valid)) return null;
    return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
  };
  const nose = mean([1, 4, 5, 195]), left = mean([33, 133]), right = mean([263, 362]);
  if (!nose || !left || !right) return null;
  const width = distance(left, right);
  if (width < 0.04) return null;
  const ux = (right.x - left.x) / width, uy = (right.y - left.y) / width;
  const dx = nose.x - (left.x + right.x) / 2, dy = nose.y - (left.y + right.y) / 2;
  return { x: (dx * ux + dy * uy) / width, y: (-dx * uy + dy * ux) / width };
}

export function createHeadInput(options: CursorOptions & {
  onCalibration?: (progress: number) => void;
  sensitivity?: number;
} = {}) {
  const cursor = new TrackedCursor('head', { ...options,
    smoothing: { medianWindow: 5, deadzone: 0.01, timeConstantMs: 220, fastTimeConstantMs: 65, ...options.smoothing } });
  const gain = clamp(options.sensitivity ?? 1, 0.5, 2);
  let neutral: Point | undefined;
  let samples: Point[] = [];
  let since: number | undefined;
  let lastFrame: number | undefined;
  let recovering = false;
  let recovery: Point[] = [];
  const reset = () => {
    cursor.reset(); samples = []; since = undefined; lastFrame = undefined;
    recovering = !!neutral; recovery = [];
  };
  return {
    reset,
    calibrate() { neutral = undefined; reset(); options.onCalibration?.(0); },
    get calibrated() { return !!neutral; },
    update(landmarks: readonly Landmark[], now: number) {
      if (lastFrame !== undefined && (now - lastFrame > 250 || now <= lastFrame)) reset();
      lastFrame = now;
      const pose = headPose(landmarks);
      if (!pose) { reset(); if (!neutral) options.onCalibration?.(0); return; }
      if (!neutral) {
        if (samples.length && distance(pose, samples[0]) > 0.05) { samples = []; since = undefined; }
        since ??= now;
        samples.push(pose);
        const progress = Math.min(1, (now - since) / 1500, samples.length / 20);
        options.onCalibration?.(progress);
        if (progress === 1) {
          neutral = { x: median(samples.map((p) => p.x)), y: median(samples.map((p) => p.y)) };
          const noise = median(samples.map((p) => Math.hypot((p.x - neutral!.x) * 1.8, (p.y - neutral!.y) * 2.2)));
          cursor.setDeadzone(clamp(noise * gain * 4, 0.008, 0.03));
          samples = [];
          cursor.update({ x: 0.5, y: 0.5 }, now, false);
        }
        return;
      }
      if (recovering) {
        recovery.push(pose);
        if (recovery.length < 5) return;
        // Do not initialize smoothing from one noisy reacquisition frame.
        pose.x = median(recovery.map((p) => p.x)); pose.y = median(recovery.map((p) => p.y));
        recovering = false; recovery = [];
      }
      cursor.update({ x: 0.5 - (pose.x - neutral.x) * 1.8 * gain,
        y: 0.5 + (pose.y - neutral.y) * 2.2 * gain }, now);
    },
  };
}
