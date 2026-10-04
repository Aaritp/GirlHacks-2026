import type { GroveApi } from '../api/contracts';
import { ApiError } from '../api/contracts';
import type { IngestApi, IngestRequest, IngestResult, Account } from './contracts';
import type { Seed } from '../types';
import { MAX_TEXT } from './contracts';

export const demoAccounts: Account[] = ['Contoso', 'Fabrikam', 'Northwind'].map((name) => ({
  id: name.toLowerCase(), name, aliases: [], industry: 'Demo account', contacts: [],
}));
export const demoEmail = 'From: Alex\nTo: Sam\nDate: 2026-10-03\n\nI will send the payroll integration checklist by 2026-10-09.\n\nWe are interested in payroll integration.\n\nThere is a risk that missing credentials will delay the pilot.';
async function hash(text: string) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** Explicit development fixture adapter. Writes seeds through the shared mock GroveApi. */
export function createMockIngestApi(groveApi: GroveApi): IngestApi {
  const results = new Map<string, IngestResult>();
  const bindings = new Map<string, string>();
  const synced = new Set<string>();
  const account = (id: string) => {
    const item = demoAccounts.find((a) => a.id === id);
    if (!item) throw new ApiError(404, 'NOT_FOUND', 'Account not found.');
    return item;
  };
  const ingest = async (request: IngestRequest): Promise<IngestResult> => {
    account(request.accountId);
    if (request.fileBase64) throw new ApiError(501, 'MOCK_UPLOAD_UNAVAILABLE', 'File parsing runs on the backend. Use paste for this mock preview.');
    const text = request.text ?? request.messages?.map((m) => m.text).join('\n\n') ?? '';
    if (!text.trim() || text.length > MAX_TEXT) throw new ApiError(400, 'INVALID_REQUEST', 'Paste 1–100,000 characters.');
    const id = 'source-' + await hash(JSON.stringify(request));
    const meetingId = 'account-' + await hash(request.accountId);
    const previous = results.get(id);
    if (previous) {
      const grove = await groveApi.getGrove(meetingId);
      return structuredClone({ ...previous, seeds: grove.seeds.filter((s) => s.sourceId === id) });
    }
    const now = new Date().toISOString();
    const source = { id, meetingId, accountId: request.accountId, type: request.sourceType, title: request.title, text, createdAt: now };
    const seeds: Seed[] = [];
    // Deliberately simple mock extraction, NOT a fallback for live AI.
    const bodies = text.split(/\n\s*\n/).filter((part) => !part.startsWith('From:')).slice(0, 12);
    for (let index = 0; index < bodies.length; index++) {
      const quote = bodies[index].trim().slice(0, 500);
      const kind = /risk|delay|block/i.test(quote) ? 'risk' : /interested|need/i.test(quote) ? 'customer_need'
        : /decided|agreed/i.test(quote) ? 'decision' : 'commitment';
      const seed: Seed = { id: 'seed-' + await hash(id + index), meetingId, accountId: request.accountId,
        text: quote, quote, kind, owner: null, deadline: null, status: 'seed', health: 1,
        sourceType: request.sourceType, sourceId: id, timestampSec: null, lastActivity: now, size: 1 };
      try { seeds.push(await groveApi.createSeed(seed)); }
      catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error;
        const existing = (await groveApi.getGrove(meetingId)).seeds.find((s) => s.id === seed.id);
        if (!existing) throw error;
        seeds.push(existing);
      }
    }
    const result = { source, seeds, roots: [] };
    results.set(id, result);
    return structuredClone(result);
  };
  return {
    getAccounts: async () => structuredClone(demoAccounts),
    ingest,
    async syncSlack({ accountId, channelId }) {
      account(accountId);
      if (!/^C[A-Z0-9]{5,30}$/.test(channelId)) throw new ApiError(400, 'INVALID_CHANNEL', 'Enter a Slack channel ID beginning with C.');
      if (bindings.has(channelId) && bindings.get(channelId) !== accountId) throw new ApiError(409, 'CHANNEL_ALREADY_LINKED', 'Channel linked to another account.');
      bindings.set(channelId, accountId);
      if (synced.has(channelId)) return { importedMessages: 0, lastSyncedTs: '1791028800.000001', seeds: [], sources: [] };
      const result = await ingest({ accountId, sourceType: 'slack', title: 'Mock Slack channel ' + channelId,
        messages: [{ author: 'Alex', text: 'I will send the payroll pilot checklist.', timestamp: '2026-10-03T12:00:00Z' }] });
      synced.add(channelId);
      return { importedMessages: 1, lastSyncedTs: '1791028800.000001', seeds: result.seeds, sources: [result.source] };
    },
    async draftFollowup(accountId) {
      const selected = account(accountId);
      const seeds = (await groveApi.getGrove('account-' + await hash(accountId))).seeds;
      if (!seeds.length) throw new ApiError(409, 'NO_CONTEXT', 'Add a conversation before drafting.');
      return { subject: 'Following up with ' + selected.name,
        body: 'Hello,\n\nHere are our open commitments:\n' + seeds.filter((s) => s.kind === 'commitment' && s.status !== 'bloom')
          .map((s) => '- ' + s.text + ' (' + (s.owner ?? 'Unassigned') + '; ' + (s.deadline ?? 'No deadline') + ')').join('\n')
          + '\n\nProposed next step: review these items together.\n\n[Mock draft — review before use]' };
    },
  };
}
