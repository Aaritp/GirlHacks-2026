import { inputBus } from './inputBus';
import { clamp, distance, PoseGate, TrackedCursor, valid, type CursorOptions, type Landmark, type Point } from './tracking';

/** id is anatomical handedness, normalized at the camera boundary. */
export interface HandSample { id: string; landmarks: readonly Landmark[] }

function readHand(sample: HandSample) {
  const p = sample.landmarks;
  if (p.length < 21 || !p.every(valid)) return null;
  const palmSize = distance(p[0], p[9]);
  if (palmSize < 0.025) return null;
  const folded = [8, 12, 16, 20].every((tip) => distance(p[tip], p[0]) < distance(p[tip - 2], p[0]) * 1.05);
  const thumbUp = folded && p[4].y < p[3].y - palmSize * 0.25 && p[4].y < p[0].y - palmSize;
  // Palm anchors are less affected by closing fingers than fingertips are.
  const palm = { x: 1 - [0, 5, 9, 17].reduce((sum, i) => sum + p[i].x, 0) / 4,
    y: [0, 5, 9, 17].reduce((sum, i) => sum + p[i].y, 0) / 4 };
  return { id: sample.id, palm, thumbUp, folded,
    index: distance(p[4], p[8]) / palmSize, middle: distance(p[4], p[12]) / palmSize };
}

export interface HandInputOptions extends CursorOptions {
  /** Resume from the shared cursor after mouse use, instead of jumping to the hand. */
  getPosition?: () => Point;
}

/** Pinch is a relative movement clutch. Middle/thumb tap clicks the parked cursor.
 * No automatic dwell, planting, confirming or resizing in hand mode.
 */
export function createHandInput(options: HandInputOptions = {}) {
  const bus = options.bus ?? inputBus;
  const cursor = new TrackedCursor('hand', options);
  const backGate = new PoseGate();
  let activeId: string | undefined;
  let lastFrame: number | undefined;
  let lastPoint: Point = { x: 0.5, y: 0.5 };
  let neutralSince: number | undefined;
  let armed = false;
  let moved = false;
  let pinch: { since: number; origin: Point; cursor: Point; moving: boolean } | undefined;
  let tap: { since: number; release?: number; valid: boolean } | undefined;
  let tapReady = false;
  let middleOpenSince: number | undefined;

  function cancelInteraction() {
    pinch = undefined; tap = undefined; tapReady = false; middleOpenSince = undefined; cursor.reset();
  }
  function reset() {
    cancelInteraction(); backGate.reset(); activeId = undefined; lastFrame = undefined;
    neutralSince = undefined; armed = false; moved = false;
  }
  return {
    reset,
    update(samples: readonly HandSample[], now: number) {
      if (lastFrame !== undefined && (now - lastFrame > 250 || now <= lastFrame)) reset();
      lastFrame = now;
      const hands = samples.map(readHand).filter((hand) => hand !== null);
      if (!hands.length || hands.length > 2 || new Set(hands.map((h) => h.id)).size !== hands.length) { reset(); return; }
      const back = hands.some((h) => h.id === 'Left' && h.thumbUp);
      if (!armed) {
        // Entering view with a closed gesture must not accidentally act.
        if (hands.every((h) => !h.folded && h.index > 0.42 && h.middle > 0.5)) {
          neutralSince ??= now;
          if (now - neutralSince >= 200) armed = true;
        } else neutralSince = undefined;
        return;
      }
      if (backGate.update(back ? 'back' : null, now)) bus.emit({ type: 'dismiss', source: 'hand' });
      if (back) { cancelInteraction(); return; }

      // Two pinches have no automatic resize meaning; freeze rather than switch hands.
      if (hands.filter((h) => !h.folded && h.index < 0.42).length > 1) { cancelInteraction(); return; }
      if (activeId && !hands.some((h) => h.id === activeId)) { reset(); return; }
      const interacting = hands.find((h) => !h.folded && h.index < 0.28);
      const primary = hands.find((h) => h.id === activeId) ?? interacting ?? hands[0];
      if (primary.folded) { cancelInteraction(); return; }

      // A middle tap wins over the motion clutch, even when the index is still closed.
      if (tap) {
        if (tap.release === undefined && now - tap.since > 800) tap.valid = false;
        if (primary.middle > 0.48) {
          tap.release ??= now;
          if (now - tap.release >= 80) {
            const select = tap.valid && tap.release - tap.since >= 60;
            cancelInteraction();
            if (select) bus.emit({ type: 'select', ...lastPoint, source: 'hand' });
          }
        } else tap.release = undefined;
        return;
      }
      if (primary.middle < 0.28 && tapReady && moved) {
        activeId = primary.id;
        tap = { since: now, valid: true }; pinch = undefined; tapReady = false;
        return;
      }
      if (primary.middle > 0.5) {
        middleOpenSince ??= now;
        if (now - middleOpenSince >= 200) tapReady = true;
      } else {
        middleOpenSince = undefined;
        // Freeze on approach, before finger contact can shake the cursor.
        pinch = undefined;
        return;
      }

      const pinched = primary.index < (pinch ? 0.42 : 0.28);
      if (!pinched) { pinch = undefined; return; }
      if (!pinch) {
        if (!moved) {
          const position = options.getPosition?.();
          if (valid(position)) lastPoint = { x: clamp(position.x), y: clamp(position.y) };
        }
        activeId = primary.id;
        pinch = { since: now, origin: primary.palm, cursor: lastPoint, moving: false };
        cursor.reset();
        return;
      }
      if (now - pinch.since < 100) return;
      if (!pinch.moving) {
        pinch.moving = true; moved = true;
        cursor.update(lastPoint, now, false);
      }
      lastPoint = cursor.update({ x: clamp(pinch.cursor.x + (primary.palm.x - pinch.origin.x) * 2.2),
        y: clamp(pinch.cursor.y + (primary.palm.y - pinch.origin.y) * 2.2) }, now, false);
    },
  };
}
