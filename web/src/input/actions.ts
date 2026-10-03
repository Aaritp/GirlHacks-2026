import type { GroveEvent } from '../types';
import { inputBus, type InputBus } from './inputBus';

/** Person C supplies these handlers from the SAME actions used by their mouse UI.
 * No API/storage dependency belongs in this adapter. point/dwell are presentation only.
 */
export type FeatureInputActions = {
  [K in GroveEvent['type']]: (event: Extract<GroveEvent, { type: K }>) => void | Promise<void>;
};

const owners = new WeakSet<InputBus>();

export function connectInputActions(
  actions: FeatureInputActions,
  onError: (error: unknown) => void,
  bus: InputBus = inputBus,
): () => void {
  if (owners.has(bus)) throw new Error('Input actions already connected. Mount a single forest action owner.');
  owners.add(bus);
  let active = true;
  const bind = <K extends GroveEvent['type']>(type: K) => bus.on(type, (event) => {
    try {
      const result = actions[type](event);
      if (result) void result.catch((error: unknown) => { if (active) onError(error); });
    } catch (error) { if (active) onError(error); }
  });
  const unsubscribe = [bind('point'), bind('select'), bind('dwell'), bind('plant'),
    bind('resize'), bind('confirm'), bind('dismiss')];
  return () => {
    if (!active) return;
    active = false;
    unsubscribe.forEach((remove) => remove());
    owners.delete(bus);
  };
}
