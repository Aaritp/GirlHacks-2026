import { describe, expect, it } from 'vitest';
import { createInputBus } from './inputBus';
import { createHandInput, type HandSample } from './hands';
import type { GroveEvent } from '../types';
import { hand } from './testFixtures';
function setup() {
  const bus = createInputBus(); const events: GroveEvent[] = [];
  for (const type of ['point', 'select', 'plant', 'resize', 'confirm', 'dismiss'] as const) bus.on(type, (e) => events.push(e));
  const hands = createHandInput({ bus });
  let now = 0;
  const frames = (samples: HandSample[], duration: number) => {
    for (let elapsed = 0; elapsed < duration; elapsed += 50) { hands.update(samples, now); now += 50; }
  };
  frames([hand()], 350);
  return { hands, events, frames };
}
describe('hand arbitration', () => {
  it('selects once on a deliberate pinch release and ignores a brief misfire', () => {
    const { events, frames } = setup();
    frames([hand('Left', 0.4, 'pinch')], 50); frames([hand()], 500);
    expect(events.filter((e) => e.type === 'select')).toHaveLength(0);
    frames([hand('Left', 0.4, 'pinch')], 300); frames([hand()], 800);
    expect(events.filter((e) => e.type === 'select')).toHaveLength(1);
  });
  it('arbitrates two-hand resize, independent of result order, with one event and no select', () => {
    const { events, frames } = setup();
    frames([hand('Left', 0.3, 'pinch')], 200);
    frames([hand('Left', 0.3, 'pinch'), hand('Right', 0.7, 'pinch')], 250);
    frames([hand('Right', 0.8, 'pinch'), hand('Left', 0.2, 'pinch')], 300);
    frames([hand('Left', 0.2), hand('Right', 0.8, 'pinch')], 400);
    frames([hand('Left', 0.2), hand('Right', 0.8)], 500);
    const resize = events.filter((e) => e.type === 'resize');
    expect(resize).toHaveLength(1); expect(resize[0].scale).toBeCloseTo(1.5);
    expect(events.filter((e) => e.type === 'select')).toHaveLength(0);
  });
  it('cancels resize on lost hands and cancels pinches across loss', () => {
    const { events, frames } = setup();
    frames([hand('Left', 0.3, 'pinch'), hand('Right', 0.7, 'pinch')], 300);
    frames([hand('Left', 0.1, 'pinch')], 300); frames([], 100); frames([hand()], 400);
    frames([hand('Left', 0.4, 'pinch')], 300); frames([], 50); frames([hand()], 500);
    expect(events.filter((e) => e.type === 'resize' || e.type === 'select')).toHaveLength(0);
  });
  it('debounces all explicit poses and prevents commands repeating while held', () => {
    const { events, frames } = setup();
    for (const pose of ['fist', 'thumb', 'palm'] as const) {
      frames([hand('Left', 0.4, pose)], 1500); frames([hand()], 400);
    }
    expect(events.filter((e) => ['plant', 'confirm', 'dismiss'].includes(e.type)).map((e) => e.type))
      .toEqual(['plant', 'confirm', 'dismiss']);
  });
  it('does not activate a pose on initial acquisition or reuse stale pinches after reset', () => {
    const { hands, events, frames } = setup(); hands.reset();
    frames([hand('Left', 0.4, 'fist')], 1000);
    frames([hand('Left', 0.4, 'pinch')], 500); frames([hand()], 500);
    expect(events.filter((e) => e.type === 'plant' || e.type === 'select')).toHaveLength(0);
  });
});
