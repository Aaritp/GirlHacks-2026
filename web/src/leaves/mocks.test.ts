import { expect, it } from 'vitest';
import { createMockApi } from '../api/mocks';
import { withLeavesDemoFixtures } from './mocks';

it('whiteboard backup is labeled, saves into the mock grove and retries without duplicates', async () => {
  const api = withLeavesDemoFixtures(createMockApi({ seeds: [], roots: [] }));
  const first = await api.readWhiteboard({ meetingId: 'a', imageBase64: 'fixture-bytes' });
  const retry = await api.readWhiteboard({ meetingId: 'a', imageBase64: 'fixture-bytes' });
  expect(first.text).toContain('MOCK OCR FIXTURE');
  expect(retry.seeds).toEqual(first.seeds);
  expect((await api.getGrove('a')).seeds).toHaveLength(1);
  expect((await api.getGrove('b')).seeds).toEqual([]);
  await expect(api.getSpeechToken()).rejects.toMatchObject({ status: 501 });
});
