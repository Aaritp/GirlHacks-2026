import { describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../api/mocks';
import { demoGrove, DEMO_MEETING_ID } from '../api/fixtures';
import { connectInputActions, type FeatureInputActions } from './actions';
import { createInputBus } from './inputBus';
import { createHandInput } from './hands';
import { hand } from './testFixtures';

const emptyActions = (): FeatureInputActions => ({ point: vi.fn(), dwell: vi.fn(), select: vi.fn(),
  plant: vi.fn(), resize: vi.fn(), confirm: vi.fn(), dismiss: vi.fn() });

describe('single action owner', () => {
  it('delivers all seven events, prevents duplicate attachment and cleans up', () => {
    const bus = createInputBus(), actions = emptyActions();
    const disconnect = connectInputActions(actions, vi.fn(), bus);
    expect(() => connectInputActions(actions, vi.fn(), bus)).toThrow('already connected');
    bus.emit({ type: 'point', x: 0.5, y: 0.5, source: 'hand' });
    bus.emit({ type: 'select', x: 0.5, y: 0.5, source: 'head' });
    bus.emit({ type: 'dwell', x: 0.5, y: 0.5, progress: 0.4, source: 'head' });
    bus.emit({ type: 'plant', x: 0.5, y: 0.5, source: 'mouse' });
    bus.emit({ type: 'resize', scale: 2, source: 'hand' });
    bus.emit({ type: 'confirm', source: 'head' }); bus.emit({ type: 'dismiss', source: 'mouse' });
    for (const action of Object.values(actions)) expect(action).toHaveBeenCalledOnce();
    disconnect(); disconnect(); bus.emit({ type: 'confirm', source: 'hand' });
    expect(actions.confirm).toHaveBeenCalledOnce();
    const off = connectInputActions(actions, vi.fn(), bus); disconnect();
    bus.emit({ type: 'confirm', source: 'hand' }); expect(actions.confirm).toHaveBeenCalledTimes(2); off();
  });
  it('reports synchronous and asynchronous feature failures without retrying writes', async () => {
    const bus = createInputBus(), actions = emptyActions(), error = vi.fn();
    actions.plant = () => { throw new Error('plant failed'); };
    actions.confirm = async () => { throw new Error('write failed'); };
    connectInputActions(actions, error, bus);
    bus.emit({ type: 'plant', x: 0.5, y: 0.5, source: 'hand' }); bus.emit({ type: 'confirm', source: 'mouse' });
    await Promise.resolve(); expect(error).toHaveBeenCalledTimes(2);
  });
  it('runs a gesture through injected feature actions and the typed mock API with one write per command', async () => {
    const api = createMockApi(); const update = vi.spyOn(api, 'updateSeed');
    const bus = createInputBus(); let seed = (await api.getGrove(DEMO_MEETING_ID)).seeds[0];
    const pending: Promise<unknown>[] = [];
    // Integration stand-in for Person C: these handlers are shared by all sources.
    // Actual forest business semantics belong to C; this does not ship an alternate store.
    const actions = emptyActions();
    actions.plant = () => { const task = api.updateSeed(seed.meetingId, seed.id, { status: 'sprout' }).then((saved) => { seed = saved; }); pending.push(task); return task; };
    actions.resize = (event) => { const task = api.updateSeed(seed.meetingId, seed.id, { size: seed.size * event.scale }).then((saved) => { seed = saved; }); pending.push(task); return task; };
    actions.confirm = () => { const task = api.updateSeed(seed.meetingId, seed.id, { status: 'bloom' }).then((saved) => { seed = saved; }); pending.push(task); return task; };
    const off = connectInputActions(actions, (error) => { throw error; }, bus);
    const hands = createHandInput({ bus });
    for (let now = 0; now <= 300; now += 50) hands.update([hand()], now);
    for (let now = 350; now <= 1400; now += 50) hands.update([hand('Left', 0.4, 'fist')], now);
    await Promise.all(pending);
    expect(seed.status).toBe('sprout'); expect(update).toHaveBeenCalledTimes(1);
    bus.emit({ type: 'resize', scale: 1.5, source: 'mouse' }); await Promise.all(pending);
    bus.emit({ type: 'confirm', source: 'head' }); await Promise.all(pending);
    const reloaded = (await api.getGrove(seed.meetingId)).seeds.find((item) => item.id === seed.id)!;
    expect(reloaded.status).toBe('bloom'); expect(reloaded.size).toBe(demoGrove.seeds[0].size * 1.5);
    expect(update).toHaveBeenCalledTimes(3); off();
    // Foundation mocks are intentionally reset on browser reload; this is NOT a durability test.
    expect((await createMockApi().getGrove(seed.meetingId)).seeds[0].status).toBe('seed');
  });
});
