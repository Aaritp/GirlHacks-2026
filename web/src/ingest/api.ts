import { createJsonClient } from '../api/client';
import type { Account, IngestApi } from './contracts';

export function createIngestApi(baseUrl = '/api', fetcher: typeof fetch = fetch): IngestApi {
  const request = createJsonClient(baseUrl, fetcher);
  return {
    getAccounts: async () => (await request<{ accounts: Account[] }>('/accounts')).accounts,
    ingest: (body) => request('/ingest', 'POST', body),
    syncSlack: (body) => request('/slack/sync', 'POST', body),
    draftFollowup: (accountId) => request('/accounts/' + encodeURIComponent(accountId) + '/followup', 'POST', {}),
  };
}
