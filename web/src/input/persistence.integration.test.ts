import { expect, it } from 'vitest';
import { createHttpApi } from '../api/client';
import { demoGrove } from '../api/fixtures';
import { connectInputActions } from './actions';
import { createInputBus } from './inputBus';
import { createHandInput } from './hands';
import { hand } from './testFixtures';

// Opt in against A's development storage routes. Creates one isolated test seed;
// the shared contract has no delete route. This is not a browser reload/E2E test.
const baseUrl = import.meta.env.VITE_INPUT_TEST_API_URL as string | undefined;
it.skipIf(!baseUrl)('persists input commands through HTTP and reads them using a fresh client', async () => {
  const api = createHttpApi(baseUrl);
  const meetingId = `input-test-${crypto.randomUUID()}`;
  let seed = await api.createSeed({ ...demoGrove.seeds[0], id: crypto.randomUUID(), meetingId,
    sourceId: meetingId, text: 'Input persistence integration test', lastActivity: new Date().toISOString() });
  const original = { ...seed };
  const bus = createInputBus();
  const pending: Promise<unknown>[] = [];
  const failures: unknown[] = [];
  let writes = 0;
  const save = (patch: Parameters<typeof api.updateSeed>[2]) => {
    writes++;
    const task = api.updateSeed(meetingId, seed.id, patch).then((saved) => { seed = saved; });
    pending.push(task); return task;
  };
  // Person C's actual actions must replace these test handlers for app-level acceptance.
  const off = connectInputActions({ point() {}, dwell() {}, select() {}, dismiss() {},
    plant: () => save({ status: 'sprout' }), resize: (event) => save({ size: seed.size * event.scale }),
    confirm: () => save({ status: 'bloom' }),
  }, (error) => failures.push(error), bus);
  try {
    const hands = createHandInput({ bus });
    for (let now = 0; now <= 300; now += 50) hands.update([hand()], now);
    for (let now = 350; now <= 1200; now += 50) hands.update([hand('Left', 0.4, 'fist')], now);
    await Promise.all(pending);
    bus.emit({ type: 'resize', scale: 1.5, source: 'mouse' }); await Promise.all(pending);
    bus.emit({ type: 'confirm', source: 'head' }); await Promise.all(pending);
    expect(failures).toEqual([]); expect(writes).toBe(3);
    const reloaded = (await createHttpApi(baseUrl).getGrove(meetingId)).seeds.find((item) => item.id === seed.id);
    expect(reloaded).toMatchObject({ id: seed.id, meetingId, sourceId: original.sourceId,
      sourceType: original.sourceType, timestampSec: original.timestampSec, status: 'bloom', size: original.size * 1.5 });
  } finally { off(); }
}, 20000);
