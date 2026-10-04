import { demoGrove } from '../api/fixtures';
import type { Grove, Seed } from '../types';

/** Synthetic, explicitly labeled demo content. Live API data is never augmented. */
export function createForestDemo(now = Date.now()): Grove {
  const base = demoGrove.seeds[0];
  const day = 86_400_000;
  const date = (offset: number) => new Date(now + offset * day).toISOString().slice(0, 10);
  const item = (id: string, text: string, owner: string, status: Seed['status'], days: number, deadline: number | null): Seed => ({
    ...base, id, text, owner, status,
    health: Math.max(0, 1 - days / 7), deadline: deadline === null ? null : date(deadline),
    lastActivity: new Date(now - days * day).toISOString(), timestampSec: null,
  });
  return {
    seeds: [
      { ...base, deadline: date(2), lastActivity: new Date(now).toISOString() },
      { ...demoGrove.seeds[1], deadline: date(4), lastActivity: new Date(now - day).toISOString() },
      item('demo-access', 'Confirm sandbox access', 'Jordan', 'bloom', 2, null),
      item('demo-mapping', 'Review the field mapping', 'Alex', 'sprout', 2, 3),
      item('demo-feedback', 'Gather customer feedback', 'Riley', 'sprout', 5.5, -1),
      item('demo-agenda', 'Share the review agenda', 'Sam', 'seed', .5, 4),
    ],
    roots: [...demoGrove.roots,
      { id: 'demo-root-mapping', meetingId: base.meetingId, fromSeedId: 'demo-mapping', toSeedId: 'demo-access', type: 'depends_on' },
      { id: 'demo-root-agenda', meetingId: base.meetingId, fromSeedId: 'demo-agenda', toSeedId: 'seed-review', type: 'related' }],
  };
}
