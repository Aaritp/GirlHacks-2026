import { ApiError, type GroveApi } from '../api/contracts';
import type { Account, Seed, Source, Utterance } from '../types';

export interface TimelineItem { source: Source; seeds: Seed[] }
/** Response of GET /api/accounts/{id}/timeline: every source of the account, newest first. */
export interface AccountTimeline { accountId: string; items: TimelineItem[] }

/** The dashboard's only door to data. Both implementations fail loudly; neither falls back to the other. */
export interface AccountsApi {
  listAccounts(): Promise<Account[]>;
  getTimeline(accountId: string): Promise<AccountTimeline>;
  /** A meeting's transcript, sorted by startSec. Unknown or empty meeting gives an empty list. */
  getUtterances(meetingId: string): Promise<Utterance[]>;
  /** Completing or reopening counts as progress, so it also refreshes lastActivity. */
  setSeedStatus(seed: Seed, status: 'sprout' | 'bloom'): Promise<Seed>;
}

/** Transcripts and seed changes go through the shared client; account reads have no shared method yet. */
export function createHttpAccountsApi(grove: GroveApi, baseUrl = '/api', fetcher: typeof fetch = fetch): AccountsApi {
  async function request<T>(path: string): Promise<T> {
    const response = await fetcher(`${baseUrl.replace(/\/$/, '')}${path}`);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(response.status, payload?.error?.code ?? 'HTTP_ERROR',
        payload?.error?.message ?? `Request failed (${response.status})`);
    }
    if (payload === null) throw new ApiError(502, 'INVALID_RESPONSE', 'Expected a JSON response');
    return payload as T;
  }
  return {
    listAccounts: () => request('/accounts'),
    getTimeline: (accountId) => request(`/accounts/${encodeURIComponent(accountId)}/timeline`),
    getUtterances: async (meetingId) => (await grove.getUtterances(meetingId)).utterances,
    setSeedStatus: (seed, status) =>
      grove.updateSeed(seed.meetingId, seed.id, { status, lastActivity: new Date().toISOString() }),
  };
}

export interface AccountsData { accounts: Account[]; timelines: AccountTimeline[]; utterances?: Utterance[] }

/** Per-instance, in-memory sample data. Changes reset on reload. */
export function createMockAccountsApi(initial: AccountsData): AccountsApi {
  const data = structuredClone(initial);
  const timeline = (accountId: string) => {
    if (!data.accounts.some((account) => account.id === accountId)) {
      throw new ApiError(404, 'NOT_FOUND', 'Account not found.');
    }
    const items = (data.timelines.find((entry) => entry.accountId === accountId)?.items ?? [])
      .filter((item) => item.source.accountId === accountId)
      .map((item) => ({ ...item, seeds: item.seeds.filter((seed) => seed.accountId === accountId) }))
      .sort((a, b) => b.source.createdAt.localeCompare(a.source.createdAt));
    return { accountId, items };
  };
  return {
    async listAccounts() { return structuredClone(data.accounts); },
    async getTimeline(accountId) { return structuredClone(timeline(accountId)); },
    async getUtterances(meetingId) {
      return structuredClone((data.utterances ?? []).filter((item) => item.meetingId === meetingId)
        .sort((a, b) => a.startSec - b.startSec));
    },
    async setSeedStatus(seed, status) {
      const stored = data.timelines.flatMap((entry) => entry.items).flatMap((item) => item.seeds)
        .find((item) => item.id === seed.id && item.accountId === seed.accountId);
      if (!stored) throw new ApiError(404, 'NOT_FOUND', 'Seed not found.');
      Object.assign(stored, { status, lastActivity: new Date().toISOString() });
      return structuredClone(stored);
    },
  };
}
