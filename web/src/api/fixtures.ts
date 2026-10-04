import type { Grove, Source, Utterance } from '../types';

export const DEMO_MEETING_ID = 'demo-meeting';
export const demoSource: Source = {
  id: DEMO_MEETING_ID, meetingId: DEMO_MEETING_ID, type: 'meeting',
  title: 'Customer onboarding planning', createdAt: '2026-10-03T13:00:00Z',
};
export const demoUtterances: Utterance[] = [
  { id: 'utterance-1', meetingId: DEMO_MEETING_ID, speaker: 'Alex',
    text: "I'll send the payroll integration checklist by October 5.", startSec: 12, via: 'voice' },
  { id: 'utterance-2', meetingId: DEMO_MEETING_ID, speaker: 'Sam',
    text: "I'll schedule the customer onboarding review after the checklist is ready.", startSec: 28, via: 'voice' },
];
export const demoGrove: Grove = {
  seeds: [
    { id: 'seed-checklist', meetingId: DEMO_MEETING_ID, text: 'Send the payroll integration checklist',
      owner: 'Alex', deadline: '2026-10-05', kind: 'commitment', status: 'seed', health: 1,
      sourceType: 'meeting', sourceId: DEMO_MEETING_ID, timestampSec: 12,
      lastActivity: '2026-10-03T13:00:12Z', size: 1 },
    { id: 'seed-review', meetingId: DEMO_MEETING_ID, text: 'Schedule the customer onboarding review',
      owner: 'Sam', deadline: null, kind: 'commitment', status: 'sprout', health: 0.8,
      sourceType: 'meeting', sourceId: DEMO_MEETING_ID, timestampSec: 28,
      lastActivity: '2026-10-03T13:00:28Z', size: 1 },
  ],
  roots: [{ id: 'root-review-checklist', meetingId: DEMO_MEETING_ID,
    fromSeedId: 'seed-review', toSeedId: 'seed-checklist', type: 'depends_on' }],
};
