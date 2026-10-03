import type { GroveEvent } from '../types';

type EventType = GroveEvent['type'];
type Listener<T extends EventType> = (event: Extract<GroveEvent, { type: T }>) => void;

export function createInputBus() {
  const listeners = new Map<EventType, Set<(event: GroveEvent) => void>>();
  return {
    on<T extends EventType>(type: T, listener: Listener<T>): () => void {
      const wrapped = (event: GroveEvent) => listener(event as Extract<GroveEvent, { type: T }>);
      const group = listeners.get(type) ?? new Set();
      group.add(wrapped);
      listeners.set(type, group);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        group.delete(wrapped);
        if (group.size === 0) listeners.delete(type);
      };
    },
    emit(event: GroveEvent) {
      for (const listener of [...(listeners.get(event.type) ?? [])]) listener(event);
    },
  };
}

export type InputBus = ReturnType<typeof createInputBus>;
export const inputBus = createInputBus();
