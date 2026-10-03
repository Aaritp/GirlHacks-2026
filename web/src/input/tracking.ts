import type { InputSource } from '../types';
import { inputBus, type InputBus } from './inputBus';

export interface Point { x: number; y: number }
export interface Landmark extends Point { z?: number }
export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const valid = (p: Point | undefined): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/** Frame-rate-independent exponential smoothing. Reset after tracking loss. */
export class CursorSmoother {
  private point?: Point;
  private time = 0;
  constructor(private readonly timeConstantMs = 80) {}
  update(point: Point, now: number): Point {
    const alpha = this.point ? 1 - Math.exp(-Math.max(0, now - this.time) / this.timeConstantMs) : 1;
    this.point = {
      x: clamp((this.point?.x ?? point.x) + alpha * (point.x - (this.point?.x ?? point.x))),
      y: clamp((this.point?.y ?? point.y) + alpha * (point.y - (this.point?.y ?? point.y))),
    };
    this.time = now;
    return this.point;
  }
  reset() { this.point = undefined; }
}

export interface CursorOptions {
  bus?: InputBus;
  /** Stable ID for a currently actionable target; null disables dwell at this position. */
  targetAt?: (point: Point) => string | null;
  dwellMs?: number;
  dwellRadius?: number;
}

export class TrackedCursor {
  private readonly smoother = new CursorSmoother();
  private anchor?: Point;
  private point?: Point;
  private target: string | null = null;
  private since = 0;
  private fired = false;
  private readonly bus: InputBus;
  constructor(private readonly source: InputSource, private readonly options: CursorOptions = {}) {
    this.bus = options.bus ?? inputBus;
  }
  update(raw: Point, now: number, dwell = true): Point {
    this.point = this.smoother.update(raw, now);
    this.bus.emit({ type: 'point', ...this.point, source: this.source });
    const target = dwell ? this.options.targetAt?.(this.point) ?? null : null;
    if (!target) { this.resetDwell(); return this.point; }
    if (target !== this.target || !this.anchor || (!this.fired && distance(raw, this.anchor) > (this.options.dwellRadius ?? 0.035))) {
      this.resetDwell();
      this.target = target;
      this.anchor = raw;
      this.since = now;
    }
    if (!this.fired) {
      const progress = clamp((now - this.since) / (this.options.dwellMs ?? 1100));
      this.bus.emit({ type: 'dwell', ...this.point, progress, source: this.source });
      if (progress === 1) {
        this.fired = true;
        this.bus.emit({ type: 'select', ...this.point, source: this.source });
      }
    }
    return this.point;
  }
  resetDwell() {
    if (this.target && this.point) this.bus.emit({ type: 'dwell', ...this.point, progress: 0, source: this.source });
    this.anchor = undefined;
    this.target = null;
    this.fired = false;
  }
  reset() { this.resetDwell(); this.smoother.reset(); this.point = undefined; }
}

/** Require a stable pose and a neutral interval before another command. */
export class PoseGate {
  private candidate: string | null = null;
  private since = 0;
  private latched = false;
  private neutralSince?: number;
  update(pose: string | null, now: number): boolean {
    if (!pose) {
      this.neutralSince ??= now;
      if (now - this.neutralSince >= 250) this.latched = false;
      this.candidate = null;
      return false;
    }
    this.neutralSince = undefined;
    if (pose !== this.candidate) { this.candidate = pose; this.since = now; }
    if (this.latched || now - this.since < 650) return false;
    this.latched = true;
    return true;
  }
  reset() { this.candidate = null; this.latched = false; this.neutralSince = undefined; }
}
