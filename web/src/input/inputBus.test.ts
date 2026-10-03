import { describe, expect, it } from 'vitest';
import { createInputBus } from './inputBus';
import type { GroveEvent } from '../types';

describe('shared input stream', () => {
  it('delivers the same select contract for mouse, head, and hand', () => {
    const bus = createInputBus();
    const received: GroveEvent[] = [];
    bus.on('select', (event) => received.push(event));
    bus.on('plant', () => { throw new Error('Wrong listener'); });
    for (const source of ['mouse', 'head', 'hand'] as const) {
      bus.emit({ type: 'select', x: 0.5, y: 0.25, source });
    }
    expect(received.map((event) => event.source)).toEqual(['mouse', 'head', 'hand']);
  });

  it('cleans up subscriptions safely across repeated mount/unmount cycles', () => {
    const bus = createInputBus();
    let calls = 0;
    const listener = () => { calls++; };
    const remove = bus.on('confirm', listener);
    bus.emit({ type: 'confirm', source: 'mouse' });
    remove();
    remove();
    const removeAgain = bus.on('confirm', listener);
    remove(); // Stale cleanup must not remove the new subscription.
    bus.emit({ type: 'confirm', source: 'head' });
    removeAgain();
    bus.emit({ type: 'confirm', source: 'hand' });
    expect(calls).toBe(2);
  });
});
