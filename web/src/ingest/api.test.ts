import { describe, expect, it, vi } from 'vitest';
import { createIngestApi } from './api';
import { createMockIngestApi, demoEmail } from './mocks';
import { createMockApi } from '../api/mocks';

describe('Person B API', () => {
  it('uses typed HTTP routes and exposes upstream errors without fixture fallback', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ accounts: [] }))
      .mockResolvedValueOnce(Response.json({ subject: 'Subject', body: 'Body' }))
      .mockResolvedValueOnce(Response.json({ error: { code: 'SLACK_RATE_LIMITED', message: 'Try later.' } }, { status: 429 }));
    const api = createIngestApi('/api', fetcher);
    expect(await api.getAccounts()).toEqual([]);
    await api.draftFollowup('client & one');
    expect(fetcher.mock.calls[1][0]).toBe('/api/accounts/client%20%26%20one/followup');
    await expect(api.syncSlack({ accountId: 'contoso', channelId: 'C123456' })).rejects.toMatchObject({ status: 429, code: 'SLACK_RATE_LIMITED' });
  });
  it('shares seed persistence with the forest mock, deduplicates and preserves user changes', async () => {
    const grove = createMockApi({ seeds: [], roots: [] });
    const api = createMockIngestApi(grove);
    const request = { accountId: 'contoso', sourceType: 'email' as const, title: 'Mail', text: demoEmail };
    const first = await api.ingest(request);
    expect(first.seeds.map((s) => s.kind)).toEqual(['commitment', 'customer_need', 'risk']);
    const seed = first.seeds[0];
    await grove.updateSeed(seed.meetingId, seed.id, { status: 'bloom' });
    expect((await api.ingest(request)).seeds[0].status).toBe('bloom');
    expect((await grove.getGrove(seed.meetingId)).seeds).toHaveLength(3);
    const other = await api.ingest({ ...request, accountId: 'fabrikam' });
    expect(other.source.meetingId).not.toBe(first.source.meetingId);
    expect((await api.draftFollowup('fabrikam')).body).toContain('checklist');
  });
  it('keeps mock Slack channel bindings and skips already synced messages', async () => {
    const api = createMockIngestApi(createMockApi({ seeds: [], roots: [] }));
    expect((await api.syncSlack({ accountId: 'contoso', channelId: 'C123456' })).importedMessages).toBe(1);
    expect((await api.syncSlack({ accountId: 'contoso', channelId: 'C123456' })).importedMessages).toBe(0);
    await expect(api.syncSlack({ accountId: 'fabrikam', channelId: 'C123456' })).rejects.toMatchObject({ status: 409 });
  });
});
