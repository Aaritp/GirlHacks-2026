import { describe, expect, it } from 'vitest';
import { demoGrove } from '../api/fixtures';
import { growthState, seedHealth, sourceTime } from './health';

const seed = demoGrove.seeds[0];
const activity = Date.parse(seed.lastActivity);

describe('seed health presentation', () => {
  it('matches seven-day decay and clamps both ends', () => {
    expect(seedHealth(seed, activity - 1000)).toBe(1);
    expect(seedHealth(seed, activity + 3.5 * 86_400_000)).toBe(.5);
    expect(seedHealth(seed, activity + 8 * 86_400_000)).toBe(0);
  });
  it('shows wilted below 0.3 without changing saved progress', () => {
    const growing = { ...seed, status: 'sprout' as const };
    expect(growthState(growing, activity + 4.9 * 86_400_000)).toBe('sprout');
    expect(growthState(growing, activity + 5 * 86_400_000)).toBe('wilted');
    expect(growing.status).toBe('sprout');
  });
  it('protects completed seeds and formats source positions', () => {
    expect(seedHealth({ ...seed, status: 'bloom' }, activity + 30 * 86_400_000)).toBe(1);
    expect(sourceTime(72.6)).toBe('1:12');
    expect(sourceTime(null)).toBe('No timestamp');
  });
});
