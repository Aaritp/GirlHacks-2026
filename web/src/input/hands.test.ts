import { describe, expect, it } from 'vitest';
import { createInputBus } from './inputBus';
import { createHandInput, type HandSample } from './hands';
import type { GroveEvent } from '../types';
import { hand } from './testFixtures';

function setup() {
  const bus = createInputBus(); const events: GroveEvent[] = [];
  for (const type of ['point', 'select', 'dwell', 'plant', 'resize', 'confirm', 'dismiss'] as const) bus.on(type, (e) => events.push(e));
  const hands = createHandInput({ bus, targetAt: () => 'seed' });
  let now = 0;
  const frames = (samples: HandSample[], duration: number) => {
    for (let elapsed = 0; elapsed < duration; elapsed += 50) { hands.update(samples, now); now += 50; }
  };
  frames([hand()], 500);
  return { hands, bus, events, frames };
}
const points = (events: GroveEvent[]) => events.filter((e) => e.type === 'point');

describe('clutched hand controls', () => {
  it('moves only while pinching; release parks the cursor without clicking or dwelling', () => {
    const { events, frames } = setup();
    frames([hand('Right', 0.7)], 500);
    expect(events).toEqual([]);
    frames([hand('Right', 0.4, 'pinch')], 200);
    frames([hand('Right', 0.3, 'pinch')], 500);
    const parked = points(events).at(-1)!;
    expect(parked.x).toBeGreaterThan(0.65);
    const count = events.length;
    frames([hand('Right', 0.7)], 2000);
    expect(events).toHaveLength(count);
    expect(events.some((e) => e.type === 'select' || e.type === 'dwell')).toBe(false);
    // Regripping at a new physical position must not jump.
    frames([hand('Right', 0.8, 'pinch')], 200);
    expect(points(events).at(-1)!.x).toBeCloseTo(parked.x, 6);
  });

  it('clicks once on middle/thumb tap release, at the parked location, not the finger location', () => {
    const { events, frames } = setup();
    frames([hand('Right', 0.4, 'pinch')], 300);
    frames([hand('Right', 0.35, 'pinch')], 400);
    frames([hand()], 300);
    const parked = points(events).at(-1)!;
    frames([hand('Right', 0.8, 'tap')], 200);
    expect(events.filter((e) => e.type === 'select')).toHaveLength(0);
    frames([hand()], 500);
    expect(events.filter((e) => e.type === 'select')).toEqual([{ type: 'select', x: parked.x, y: parked.y, source: 'hand' }]);
  });

  it('ignores contact flicker, long holds and repeat contact before release rearming', () => {
    const { events, frames } = setup();
    frames([hand('Right', 0.4, 'pinch')], 300);
    frames([hand('Right', 0.4, 'tap')], 50); frames([hand()], 400);
    frames([hand('Right', 0.4, 'tap')], 1200); frames([hand()], 400);
    expect(events.filter((e) => e.type === 'select')).toHaveLength(0);
    frames([hand('Right', 0.4, 'tap')], 150); frames([hand()], 150);
    frames([hand('Right', 0.4, 'tap')], 150); frames([hand()], 400);
    expect(events.filter((e) => e.type === 'select')).toHaveLength(1);
  });

  it('tap takes precedence over pinch motion and never repeats while held', () => {
    const { events, frames } = setup();
    frames([hand('Right', 0.4, 'pinch')], 300);
    const both = hand('Right', 0.7, 'pinch');
    both.landmarks = both.landmarks.map((p, i) => i === 12 ? { ...both.landmarks[4] } : p);
    const before = points(events).at(-1)!;
    frames([both], 200); frames([hand()], 300);
    expect(events.filter((e) => e.type === 'select')).toEqual([{ type: 'select', x: before.x, y: before.y, source: 'hand' }]);
    expect(points(events).at(-1)).toEqual(before);
  });

  it('left thumbs-up goes back once; right thumbs-up, fist and palm do not execute old shortcuts', () => {
    const { events, frames } = setup();
    for (const pose of ['thumb', 'fist', 'palm'] as const) frames([hand('Right', 0.4, pose)], 1000);
    expect(events).toEqual([]);
    frames([hand('Left', 0.4, 'thumb')], 1500);
    expect(events).toEqual([{ type: 'dismiss', source: 'hand' }]);
    frames([hand('Left')], 400);
    frames([hand('Left', 0.4, 'thumb')], 800);
    expect(events).toHaveLength(2);
  });

  it('recognizes left back while the right hand controls the cursor regardless of result order', () => {
    const { events, frames } = setup();
    frames([hand('Right', 0.4, 'pinch')], 300);
    const count = points(events).length;
    frames([hand('Left', 0.7, 'thumb'), hand('Right', 0.4, 'pinch')], 400);
    frames([hand('Right', 0.4, 'pinch'), hand('Left', 0.7, 'thumb')], 500);
    expect(events.filter((e) => e.type === 'dismiss')).toHaveLength(1);
    expect(points(events)).toHaveLength(count);
  });

  it('two pinches freeze instead of triggering an accidental resize or changing controlling hands', () => {
    const { events, frames } = setup();
    frames([hand('Right', 0.4, 'pinch')], 300);
    const count = points(events).length;
    frames([hand('Right', 0.2, 'pinch'), hand('Left', 0.8, 'pinch')], 600);
    expect(points(events)).toHaveLength(count);
    expect(events.some((e) => e.type === 'resize')).toBe(false);
  });

  it('cancels a pending tap on loss and requires an open hand before reacquisition', () => {
    const { events, frames } = setup();
    frames([hand('Right', 0.4, 'pinch')], 300);
    frames([hand('Right', 0.4, 'tap')], 150);
    frames([], 50); frames([hand('Right', 0.4, 'tap')], 300); frames([hand()], 300);
    expect(events.filter((e) => e.type === 'select')).toHaveLength(0);
  });

  it('does not acquire a held pinch/tap or thumbs-up as an initial gesture', () => {
    const { hands, events, frames } = setup(); hands.reset();
    frames([hand('Left', 0.4, 'thumb')], 1000);
    frames([hand('Right', 0.4, 'pinch')], 500);
    frames([hand('Right', 0.4, 'tap')], 500);
    expect(events).toEqual([]);
  });

  it('ignores invalid landmarks and handedness changes during a tap', () => {
    const { events, frames } = setup();
    frames([hand('Right', 0.4, 'pinch')], 300);
    frames([hand('Right', 0.4, 'tap')], 150);
    frames([hand('Left')], 200);
    const invalid = hand(); invalid.landmarks = [{ x: NaN, y: 0 }];
    frames([invalid], 200);
    expect(events.filter((e) => e.type === 'select')).toHaveLength(0);
  });
});
