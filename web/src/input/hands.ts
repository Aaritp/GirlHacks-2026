import { inputBus } from './inputBus';
import { clamp, distance, PoseGate, TrackedCursor, valid, type CursorOptions, type Landmark } from './tracking';

export interface HandSample { id: string; landmarks: readonly Landmark[] }
type Pose = 'plant' | 'confirm' | 'dismiss';

function readHand(sample: HandSample) {
  const p = sample.landmarks;
  if (p.length < 21 || !p.every(valid)) return null;
  const palm = distance(p[0], p[9]);
  if (palm < 0.025) return null;
  const extended = [8, 12, 16, 20].map((tip) => distance(p[tip], p[0]) > distance(p[tip - 2], p[0]) * 1.2);
  const folded = [8, 12, 16, 20].every((tip) => distance(p[tip], p[0]) < distance(p[tip - 2], p[0]) * 1.05);
  const thumbUp = p[4].y < p[3].y - palm * 0.25 && p[4].y < p[0].y - palm;
  const pose: Pose | null = folded ? (thumbUp ? 'confirm' : 'plant')
    : extended.every(Boolean) && distance(p[4], p[8]) > palm * 0.7 ? 'dismiss' : null;
  return { id: sample.id, point: { x: 1 - p[8].x, y: p[8].y }, ratio: distance(p[4], p[8]) / palm, pose };
}

/** Pinch selects on release. Two simultaneous pinches exclusively own a resize. */
export function createHandInput(options: CursorOptions = {}) {
  const bus = options.bus ?? inputBus;
  const cursor = new TrackedCursor('hand', options);
  const gate = new PoseGate();
  const pinched = new Map<string, boolean>();
  let activeId: string | undefined;
  let pinchSince: number | undefined;
  let releaseSince: number | undefined;
  let resize: { start: number; scale: number; since: number } | undefined;
  let blocked = true;
  let lastFrame: number | undefined;
  let lastPoint = { x: 0.5, y: 0.5 };
  function reset() {
    cursor.reset(); gate.reset(); pinched.clear(); activeId = undefined;
    pinchSince = undefined; releaseSince = undefined; resize = undefined; blocked = true; lastFrame = undefined;
  }
  return {
    reset,
    update(samples: readonly HandSample[], now: number) {
      if (lastFrame !== undefined && now - lastFrame > 250) reset();
      lastFrame = now;
      const hands = samples.map(readHand).filter((hand) => hand !== null);
      if (!hands.length || hands.length > 2 || new Set(hands.map((h) => h.id)).size !== hands.length) { reset(); return; }
      if (activeId && !hands.some((h) => h.id === activeId)) { reset(); return; }
      for (const id of pinched.keys()) if (!hands.some((h) => h.id === id)) pinched.delete(id);
      for (const hand of hands) pinched.set(hand.id, hand.pose !== 'plant' && hand.pose !== 'confirm'
        && hand.ratio < (pinched.get(hand.id) ? 0.42 : 0.28));
      const primary = hands.find((h) => h.id === activeId) ?? hands[0];
      activeId = primary.id;
      const count = hands.filter((h) => pinched.get(h.id)).length;
      if (blocked) {
        if (count === 0 && !primary.pose) {
          releaseSince ??= now;
          if (now - releaseSince >= 250) { blocked = false; releaseSince = undefined; }
        } else releaseSince = undefined;
        lastPoint = cursor.update(primary.point, now, false);
        return;
      }
      if (count === 2) {
        const span = distance(hands[0].point, hands[1].point);
        if (!resize && span < 0.08) { reset(); return; }
        if (!resize && span >= 0.08) resize = { start: span, scale: 1, since: now };
        if (resize) resize.scale = clamp(span / resize.start, 0.25, 4);
        pinchSince = undefined; releaseSince = undefined;
        gate.update(null, now);
        cursor.resetDwell();
        return;
      }
      if (resize) {
        // Tracking loss cancels; an observed release commits once, then both hands must relax.
        if (hands.length === 2 && now - resize.since >= 180 && Math.abs(resize.scale - 1) >= 0.05) {
          bus.emit({ type: 'resize', scale: resize.scale, source: 'hand' });
        }
        resize = undefined; blocked = true; releaseSince = undefined; cursor.reset();
        return;
      }
      const isPinched = !!pinched.get(primary.id);
      if (isPinched) {
        pinchSince ??= now;
        releaseSince = undefined;
        cursor.resetDwell();
        gate.update(null, now);
        return;
      }
      if (pinchSince !== undefined) {
        releaseSince ??= now;
        if (now - releaseSince < 100) return;
        if (releaseSince - pinchSince >= 120 && releaseSince - pinchSince <= 2000) {
          bus.emit({ type: 'select', ...lastPoint, source: 'hand' });
        }
        pinchSince = undefined; releaseSince = undefined; blocked = true; cursor.resetDwell();
        return;
      }
      if (gate.update(primary.pose, now)) {
        if (primary.pose === 'plant') bus.emit({ type: 'plant', ...lastPoint, source: 'hand' });
        else if (primary.pose) bus.emit({ type: primary.pose, source: 'hand' });
      }
      // Command poses keep the previous cursor position; only pointing can dwell.
      if (primary.pose) cursor.resetDwell();
      else lastPoint = cursor.update(primary.point, now);
    },
  };
}
