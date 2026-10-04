import type { Seed } from '../types';

export type GrowthState = Seed['status'];

export function seedHealth(seed: Seed, now = Date.now()): number {
  if (seed.status === 'bloom') return 1;
  const activity = Date.parse(seed.lastActivity);
  if (!Number.isFinite(activity)) return Math.max(0, Math.min(1, seed.health));
  const days = Math.max(0, (now - activity) / 86_400_000);
  return Math.round(Math.max(0, Math.min(1, 1 - days / 7)) * 10_000) / 10_000;
}

export function growthState(seed: Seed, now = Date.now()): GrowthState {
  if (seed.status === 'bloom') return 'bloom';
  return seedHealth(seed, now) < 0.3 ? 'wilted' : seed.status;
}

export const growthLabels: Record<GrowthState, string> = {
  seed: 'Planted', sprout: 'Growing', bloom: 'Completed', wilted: 'Needs care',
};

export function sourceTime(seconds: number | null): string {
  if (seconds === null) return 'No timestamp';
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function formatDeadline(deadline: string | null): string {
  if (!deadline) return 'No deadline';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${deadline}T12:00:00Z`));
}
