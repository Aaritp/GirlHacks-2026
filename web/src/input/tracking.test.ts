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
    smoother.update({ x: 1, y: 0 }, 16);
    const moved = smoother.update({ x: 1, y: 0 }, 32);
    expect(moved.x).toBeGreaterThan(0.5); expect(moved.x).toBeLessThan(0.8);
    smoother.reset();
    expect(smoother.update({ x: 5, y: -1 }, 20)).toEqual({ x: 1, y: 0 });
  });
  it('delivers progress and exactly one selection until the pointer leaves the target', () => {
    const { bus, events } = recorder();
    const cursor = new TrackedCursor('head', { bus, targetAt: (p) => p.x > 0.9 ? null : 'seed', dwellMs: 1000,
      smoothing: { medianWindow: 1 } });
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
  it('keeps the cursor still under sub-dead-zone hand jitter and rejects a one-frame spike', () => {
    const smoother = new CursorSmoother();
    smoother.update({ x: 0.5, y: 0.5 }, 0);
    for (let i = 1; i <= 80; i++) {
      const point = i === 15 ? { x: 0.9, y: 0.1 }
        : { x: 0.5 + 0.003 * Math.sin(i), y: 0.5 + 0.003 * Math.cos(i) };
      expect(smoother.update(point, i * 50)).toEqual({ x: 0.5, y: 0.5 });
    }
  });
  it('still reaches both viewport edges on sustained intentional movement', () => {
    const smoother = new CursorSmoother(); smoother.update({ x: 0.5, y: 0.5 }, 0);
    for (let t = 50; t <= 1000; t += 50) smoother.update({ x: 1.1, y: -0.1 }, t);
    expect(smoother.update({ x: 1.1, y: -0.1 }, 1050)).toEqual({ x: 1, y: 0 });
    for (let t = 1100; t <= 2200; t += 50) smoother.update({ x: -0.1, y: 1.1 }, t);
    expect(smoother.update({ x: -0.1, y: 1.1 }, 2250)).toEqual({ x: 0, y: 1 });
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
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  for (const i of [33, 133]) points[i] = { x: 0.4, y: 0.4 };
  for (const i of [263, 362]) points[i] = { x: 0.6, y: 0.4 };
  return points;
};
describe('head tracking', () => {
  it('reduces stationary landmark noise by at least 65% versus the previous nose-tip filter', () => {
    const { bus, events } = recorder();
    const head = createHeadInput({ bus });
    const noisy = (frame: number) => face().map((point, i) => ({
      x: point.x + 0.0015 * Math.sin(frame * 1.31 + i * 0.91),
      y: point.y + 0.001 * Math.cos(frame * 1.17 + i * 0.81),
    }));
    for (let frame = 0; frame <= 30; frame++) head.update(noisy(frame), frame * 50);
    expect(head.calibrated).toBe(true);
    let oldX = 0.5;
    const previous: number[] = [];
    events.length = 0;
    for (let frame = 31; frame < 231; frame++) {
      const p = noisy(frame);
      head.update(p, frame * 50);
      const width = Math.hypot(p[33].x - p[263].x, p[33].y - p[263].y);
      const raw = 0.5 - (p[1].x - (p[33].x + p[263].x) / 2) / width * 2.5;
      oldX += (1 - Math.exp(-50 / 80)) * (raw - oldX);
      previous.push(oldX);
    }
    const xs = events.filter((e) => e.type === 'point').map((e) => e.x);
    const rms = (values: number[]) => {
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
    };
    expect(xs.length).toBe(200);
    expect(rms(previous)).toBeGreaterThan(0.001);
    expect(rms(xs)).toBeLessThan(rms(previous) * 0.35);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.01);
  });
  it('rejects an isolated landmark spike, including immediately after calibration', () => {
    const { bus, events } = recorder();
    const head = createHeadInput({ bus });
    for (let now = 0; now <= 1500; now += 50) head.update(face(), now);
    const spike = face(); for (const i of [1, 4, 5, 195]) spike[i].x += 0.08;
    head.update(spike, 1550);
    for (let now = 1600; now <= 2000; now += 50) head.update(face(), now);
    for (const event of events.filter((e) => e.type === 'point')) expect(event.x).toBe(0.5);
  });
  it('cancels translation, scale and roll rather than interpreting them as head pointing', () => {
    const { bus, events } = recorder(); const head = createHeadInput({ bus });
    for (let now = 0; now <= 1500; now += 50) head.update(face(), now);
    const angle = 0.2;
    const transformed = face().map((p) => ({
      x: 0.6 + ((p.x - 0.5) * Math.cos(angle) - (p.y - 0.5) * Math.sin(angle)) * 0.8,
      y: 0.6 + ((p.x - 0.5) * Math.sin(angle) + (p.y - 0.5) * Math.cos(angle)) * 0.8,
    }));
    for (let now = 1550; now <= 2500; now += 50) head.update(transformed, now);
    for (const event of events.filter((e) => e.type === 'point')) {
      expect(event.x).toBeCloseTo(0.5, 6); expect(event.y).toBeCloseTo(0.5, 6);
    }
  });
  it('preserves deliberate small movements beyond the dead zone', () => {
    const { bus, events } = recorder(); const head = createHeadInput({ bus });
    for (let now = 0; now <= 1500; now += 50) head.update(face(), now);
    const small = face(); for (const i of [1, 4, 5, 195]) small[i].x += 0.004;
    for (let now = 1550; now <= 2300; now += 50) head.update(small, now);
    expect((events.at(-1) as { x: number }).x).toBeLessThan(0.475);
  });
  it('requires stable calibration, maps relative motion, and recalibrates', () => {
    const { bus, events } = recorder();
    const head = createHeadInput({ bus });
    for (let now = 0; now <= 1500; now += 50) head.update(face(), now);
    expect(head.calibrated).toBe(true);
    head.update(face(), 1550);
    expect(events[0]).toMatchObject({ type: 'point', x: 0.5, y: 0.5, source: 'head' });
    const turned = face(); for (const i of [1, 4, 5, 195]) turned[i].x += 0.02;
    for (let now = 1600; now <= 2100; now += 50) head.update(turned, now);
    expect((events.at(-1) as { x: number }).x).toBeLessThan(0.4);
    head.calibrate(); expect(head.calibrated).toBe(false);
  });
  it('resets pending dwell on face loss and frame gaps', () => {
    const { bus, events } = recorder();
    const head = createHeadInput({ bus, targetAt: () => 'seed', dwellMs: 500 });
    for (let now = 0; now <= 1900; now += 50) head.update(face(), now);
    head.update([], 1950);
    head.update(face(), 2000); head.update(face(), 3000);
    expect(events.filter((e) => e.type === 'select')).toHaveLength(0);
  });
});
