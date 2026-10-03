import type { HandSample } from './hands';

// Synthetic geometry tests state transitions, not physical camera accuracy.
export function hand(id = 'Left', x = 0.4, pose: 'point' | 'pinch' | 'fist' | 'thumb' | 'palm' = 'point'): HandSample {
  const p = Array.from({ length: 21 }, () => ({ x, y: 0.65 }));
  p[0] = { x, y: 0.8 }; p[9] = { x, y: 0.6 };
  for (const tip of [8, 12, 16, 20]) {
    p[tip - 2] = { x, y: 0.6 };
    p[tip] = { x, y: pose === 'palm' || pose === 'pinch' || (pose === 'point' && tip === 8) ? 0.4 : 0.7 };
  }
  p[3] = { x: x - 0.12, y: 0.65 };
  p[4] = pose === 'pinch' ? { x: x + 0.015, y: 0.4 }
    : pose === 'thumb' ? { x: x - 0.12, y: 0.35 } : { x: x - 0.16, y: 0.65 };
  return { id, landmarks: p };
}
