import { distance, TrackedCursor, valid, type CursorOptions, type Landmark, type Point } from './tracking';

/** Nose relative to eye midpoint/spacing: cancels much of camera translation and distance. */
function headPose(landmarks: readonly Landmark[]): Point | null {
  const nose = landmarks[1], left = landmarks[33], right = landmarks[263];
  if (!valid(nose) || !valid(left) || !valid(right)) return null;
  const width = distance(left, right);
  if (width < 0.04) return null;
  return { x: (nose.x - (left.x + right.x) / 2) / width, y: (nose.y - (left.y + right.y) / 2) / width };
}

export function createHeadInput(options: CursorOptions & { onCalibration?: (progress: number) => void } = {}) {
  const cursor = new TrackedCursor('head', options);
  let neutral: Point | undefined;
  let samples: Point[] = [];
  let since: number | undefined;
  let lastFrame: number | undefined;
  const reset = () => { cursor.reset(); samples = []; since = undefined; lastFrame = undefined; };
  return {
    reset,
    calibrate() { neutral = undefined; reset(); options.onCalibration?.(0); },
    get calibrated() { return !!neutral; },
    update(landmarks: readonly Landmark[], now: number) {
      if (lastFrame !== undefined && now - lastFrame > 250) reset();
      lastFrame = now;
      const pose = headPose(landmarks);
      if (!pose) { reset(); if (!neutral) options.onCalibration?.(0); return; }
      if (!neutral) {
        if (samples.length && distance(pose, samples[0]) > 0.06) { samples = []; since = undefined; }
        since ??= now;
        samples.push(pose);
        const progress = Math.min(1, (now - since) / 1000);
        options.onCalibration?.(progress);
        if (progress === 1 && samples.length >= 10) {
          neutral = { x: samples.reduce((s, p) => s + p.x, 0) / samples.length,
            y: samples.reduce((s, p) => s + p.y, 0) / samples.length };
          samples = [];
        }
        return;
      }
      cursor.update({ x: 0.5 - (pose.x - neutral.x) * 2.5, y: 0.5 + (pose.y - neutral.y) * 3 }, now);
    },
  };
}
