import { describe, expect, it } from 'vitest';
import type { GroveEvent } from '../types';
import { createInputBus } from './inputBus';
import { CursorSmoother, PoseGate, TrackedCursor } from './tracking';
import { createHeadInput } from './head';

function recorder() {
  const bus = createInputBus();
  const events: GroveEvent[] = [];
  for (const type of ['point', 'select', 'dwell'] as const) bus.on(type, (event) => events.push(event));
  return { bus, events };
}

describe('tracked cursor', () => {
  it('smooths jitter, clamps coordinates, and resets without drifting from the old position', () => {
    const smoother = new CursorSmoother();
    expect(smoother.update({ x: 0.5, y: 0.5 }, 0)).toEqual({ x: 0.5, y: 0.5 });
    const moved = smoother.update({ x: 1, y: 0 }, 16);
    expect(moved.x).toBeGreaterThan(0.5); expect(moved.x).toBeLessThan(0.7);
    smoother.reset();
    expect(smoother.update({ x: 5, y: -1 }, 20)).toEqual({ x: 1, y: 0 });
  });
  it('delivers progress and exactly one selection until the pointer leaves the target', () => {
    const { bus, events } = recorder();
    const cursor = new TrackedCursor('head', { bus, targetAt: (p) => p.x > 0.9 ? null : 'seed', dwellMs: 1000 });
    for (const now of [0, 500, 1000, 1500, 2000]) cursor.update({ x: 0.5, y: 0.5 }, now);
    expect(events.filter((e) => e.type === 'select')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'dwell').map((e) => e.progress)).toEqual([0, 0.5, 1]);
    cursor.update({ x: 0.8, y: 0.5 }, 2100);
    cursor.update({ x: 0.8, y: 0.5 }, 3100);
    expect(events.filter((e) => e.type === 'select')).toHaveLength(1);
    cursor.update({ x: 1, y: 0.5 }, 4000);
    cursor.update({ x: 0.5, y: 0.5 }, 5000);
    cursor.update({ x: 0.5, y: 0.5 }, 6000);
    expect(events.filter((e) => e.type === 'select')).toHaveLength(2);
  });
  it('cancels on target changes, missing targets, explicit gestures and tracking loss', () => {
    const { bus, events } = recorder();
    let target: string | null = 'seed-a';
    const cursor = new TrackedCursor('hand', { bus, targetAt: () => target });
    cursor.update({ x: 0.5, y: 0.5 }, 0);
    cursor.update({ x: 0.5, y: 0.5 }, 1000);
    target = 'seed-b'; cursor.update({ x: 0.5, y: 0.5 }, 1100);
    cursor.update({ x: 0.5, y: 0.5 }, 1500, false);
    target = null; cursor.update({ x: 0.5, y: 0.5 }, 9000);
    cursor.reset();
    expect(events.filter((e) => e.type === 'select')).toHaveLength(0);
  });
});

describe('pose debounce', () => {
  it('ignores brief poses and requires neutral before repeating or changing commands', () => {
    const gate = new PoseGate();
    expect(gate.update('plant', 0)).toBe(false);
    expect(gate.update('plant', 100)).toBe(false);
    gate.update(null, 150);
    expect(gate.update('plant', 200)).toBe(false);
    expect(gate.update('plant', 900)).toBe(true);
    expect(gate.update('plant', 2000)).toBe(false);
    expect(gate.update('confirm', 2100)).toBe(false);
    expect(gate.update('confirm', 3000)).toBe(false);
    gate.update(null, 3100); gate.update(null, 3400);
    gate.update('confirm', 3500);
    expect(gate.update('confirm', 4200)).toBe(true);
  });
});

const face = () => {
  const points = Array.from({ length: 264 }, () => ({ x: 0.5, y: 0.5 }));
  points[33] = { x: 0.4, y: 0.4 }; points[263] = { x: 0.6, y: 0.4 };
  return points;
};
describe('head tracking', () => {
  it('requires stable calibration, maps relative motion, and recalibrates', () => {
    const { bus, events } = recorder();
    const head = createHeadInput({ bus });
    for (let now = 0; now <= 1000; now += 50) head.update(face(), now);
    expect(head.calibrated).toBe(true);
    expect(events).toHaveLength(0);
    head.update(face(), 1050);
    expect(events[0]).toMatchObject({ type: 'point', x: 0.5, y: 0.5, source: 'head' });
    const turned = face(); turned[1].x += 0.02;
    head.update(turned, 1100);
    expect((events[1] as { x: number }).x).toBeLessThan(0.5);
    head.calibrate(); expect(head.calibrated).toBe(false);
  });
  it('resets pending dwell on face loss and frame gaps', () => {
    const { bus, events } = recorder();
    const head = createHeadInput({ bus, targetAt: () => 'seed', dwellMs: 500 });
    for (let now = 0; now <= 1400; now += 50) head.update(face(), now);
    head.update([], 1450);
    head.update(face(), 1500); head.update(face(), 2500);
    expect(events.filter((e) => e.type === 'select')).toHaveLength(0);
  });
});
