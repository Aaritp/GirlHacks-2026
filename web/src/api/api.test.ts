import { describe, expect, it, vi } from 'vitest';
import { createHttpApi } from './client';
import { createMockApi } from './mocks';
import { demoGrove, demoUtterances, DEMO_MEETING_ID } from './fixtures';

describe('mock API', () => {
  it('isolates meetings, even when they share a seed ID', async () => {
    const api = createMockApi();
    const seed = { ...demoGrove.seeds[0], meetingId: 'another-meeting' };
    await api.createSeed(seed);
    await api.updateSeed('another-meeting', seed.id, { status: 'bloom' });
    expect((await api.getGrove('another-meeting')).seeds[0].status).toBe('bloom');
    expect((await api.getGrove(DEMO_MEETING_ID)).seeds[0].status).toBe('seed');
    await expect(api.updateSeed('missing', seed.id, { status: 'bloom' })).rejects.toMatchObject({ status: 404 });
  });

  it('returns copies and isolates separate API instances', async () => {
    const api = createMockApi();
    const response = await api.getGrove(DEMO_MEETING_ID);
    response.seeds[0].text = 'Changed outside the store';
    expect((await api.getGrove(DEMO_MEETING_ID)).seeds[0].text).toBe(demoGrove.seeds[0].text);
    await api.updateSeed(DEMO_MEETING_ID, demoGrove.seeds[0].id, { owner: null });
    expect((await createMockApi().getGrove(DEMO_MEETING_ID)).seeds[0].owner).toBe('Alex');
  });

  it('rejects duplicate creates and keeps source provenance immutable', async () => {
    const api = createMockApi();
    await expect(api.createSeed(demoGrove.seeds[0])).rejects.toMatchObject({ status: 409 });
    await expect(api.updateSeed(DEMO_MEETING_ID, demoGrove.seeds[0].id,
      // @ts-expect-error Exercise a malformed caller at the runtime boundary.
      { sourceId: 'changed-source' })).rejects.toMatchObject({ status: 400 });
  });

  it('deduplicates rolling transcript windows without resetting seed progress', async () => {
    const api = createMockApi({ seeds: [], roots: [] });
    const request = { meetingId: DEMO_MEETING_ID, utterances: demoUtterances };
    const first = await api.extract(request);
    await api.updateSeed(DEMO_MEETING_ID, first.seeds[0].id, { status: 'bloom' });
    const second = await api.extract(request);
    expect(second.seeds).toHaveLength(2);
    expect(second.seeds[0].status).toBe('bloom');
    expect(second.seeds[0].timestampSec).toBe(12);
    expect((await api.getGrove(DEMO_MEETING_ID)).seeds).toHaveLength(2);
    await expect(api.extract({ ...request, meetingId: 'wrong-meeting' })).rejects.toMatchObject({ status: 400 });
  });

  it('returns composed text only and does not pretend to provide Speech or OCR', async () => {
    const api = createMockApi();
    expect(await api.compose({ meetingId: DEMO_MEETING_ID, picked: ['a', 'custom', 'word'] }))
      .toEqual({ sentence: 'a custom word' });
    await expect(api.compose({ meetingId: DEMO_MEETING_ID, picked: [] })).rejects.toMatchObject({ status: 400 });
    await expect(api.getSpeechToken()).rejects.toMatchObject({ status: 501 });
    await expect(api.readWhiteboard({ meetingId: DEMO_MEETING_ID, imageBase64: 'test' }))
      .rejects.toMatchObject({ status: 501 });
  });

  it('rejects invalid patch values and empty extraction windows', async () => {
    const api = createMockApi();
    for (const patch of [{}, { health: 2 }, { size: 0 }]) {
      await expect(api.updateSeed(DEMO_MEETING_ID, demoGrove.seeds[0].id, patch))
        .rejects.toMatchObject({ status: 400 });
    }
    await expect(api.extract({ meetingId: DEMO_MEETING_ID, utterances: [] }))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe('HTTP API', () => {
  it('sends the partition key and encoded seed ID on a patch', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(demoGrove.seeds[0]));
    await createHttpApi('/api/', fetcher).updateSeed('meeting & two', 'seed one', { owner: null });
    expect(fetcher).toHaveBeenCalledWith('/api/seeds/seed%20one?meetingId=meeting%20%26%20two', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"owner":null}',
    });
  });

  it('preserves server error codes and handles non-JSON failures', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: { code: 'NOT_FOUND', message: 'Seed not found.' } }, { status: 404 }))
      .mockResolvedValueOnce(new Response('<html>Unavailable</html>', { status: 503 }));
    const api = createHttpApi('/api', fetcher);
    await expect(api.getGrove('missing')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    await expect(api.getGrove('missing')).rejects.toMatchObject({ status: 503, code: 'HTTP_ERROR' });
  });
});
