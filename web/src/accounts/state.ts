import type { GrowthState } from '../forest/health';
import type { AccountSeed, AccountTimeline, SeedKind, SourceType } from './types';

export type DisplayState = 'growing' | 'blooming' | 'wilting';

/** Local calendar date as YYYY-MM-DD, comparable with seed deadlines. */
export function today(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const isOpen = (seed: AccountSeed) => seed.status !== 'bloom';
export const isOverdue = (seed: AccountSeed, date = today()) =>
  isOpen(seed) && seed.deadline !== null && seed.deadline < date;

/** Done blooms. An open seed wilts when overdue or when it is a flagged risk. Otherwise it grows. */
export function displayState(seed: AccountSeed, date = today()): DisplayState {
  if (!isOpen(seed)) return 'blooming';
  return seed.kind === 'risk' || isOverdue(seed, date) ? 'wilting' : 'growing';
}

export function stateReason(seed: AccountSeed, date = today()): string {
  if (!isOpen(seed)) return 'Done';
  if (isOverdue(seed, date)) return `Overdue since ${seed.deadline}`;
  if (seed.kind === 'risk') return 'Flagged risk';
  return 'Open';
}

export const stateLabels: Record<DisplayState, string> = {
  growing: 'Growing', blooming: 'Blooming', wilting: 'Wilting',
};
export const plantFor: Record<DisplayState, GrowthState> = {
  growing: 'sprout', blooming: 'bloom', wilting: 'wilted',
};
export const kindLabels: Record<SeedKind, string> = {
  commitment: 'Commitment', decision: 'Decision', risk: 'Risk', customer_need: 'Customer need',
};
export const sourceLabels: Record<SourceType | 'leaves', string> = {
  meeting: 'Meeting', whiteboard: 'Whiteboard', email: 'Email', chat: 'Chat',
  document: 'Document', slack: 'Slack', leaves: 'Whispering Leaves',
};

export const UNASSIGNED = '__unassigned__';
export interface SeedFilter { kind: SeedKind | 'all'; owner: string }
export const noFilter: SeedFilter = { kind: 'all', owner: 'all' };

export function filterSeeds(seeds: AccountSeed[], filter: SeedFilter): AccountSeed[] {
  return seeds.filter((seed) => (filter.kind === 'all' || seed.kind === filter.kind)
    && (filter.owner === 'all' || (filter.owner === UNASSIGNED ? seed.owner === null : seed.owner === filter.owner)));
}

/** Seeds of exactly this account. A seed carrying another accountId is dropped, never shown. */
export function accountSeeds(timeline: AccountTimeline): AccountSeed[] {
  const seen = new Set<string>();
  return timeline.items.flatMap((item) => item.seeds).filter((seed) => {
    if (seed.accountId !== timeline.accountId || seen.has(seed.id)) return false;
    seen.add(seed.id);
    return true;
  });
}

export function newestFirst(timeline: AccountTimeline) {
  return timeline.items.filter((item) => item.source.accountId === timeline.accountId)
    .sort((a, b) => b.source.createdAt.localeCompare(a.source.createdAt) || a.source.id.localeCompare(b.source.id));
}

export interface AccountSummary { openCommitments: number; risks: number }
export function summarize(timeline: AccountTimeline): AccountSummary {
  const seeds = accountSeeds(timeline);
  return {
    openCommitments: seeds.filter((seed) => seed.kind === 'commitment' && isOpen(seed)).length,
    risks: seeds.filter((seed) => seed.kind === 'risk' && isOpen(seed)).length,
  };
}

export function formatDay(iso: string): string {
  const value = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(value.getTime())) return 'Unknown date';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(value);
}
