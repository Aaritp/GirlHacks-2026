import { useEffect, useRef, type ReactNode } from 'react';
import { connectInputActions, type FeatureInputActions } from './actions';
import { InputControls, type InputControlsProps } from './InputControls';
import { inputBus } from './inputBus';
import { attachMouseInput } from './mouse';
import { activateInputControl } from './targets';

/** Optional app composition owned here so integration needs only a single wrapper.
 * Pass stable Person C action callbacks; do not also subscribe those actions to the bus.
 */
export function InputSurface({ actions, onError, children, ...controls }: InputControlsProps & {
  actions: FeatureInputActions;
  onError: (error: unknown) => void;
  children: ReactNode;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const current = useRef({ actions, onError });
  current.current = { actions, onError };
  const bus = controls.bus ?? inputBus;
  useEffect(() => {
    const target = surface.current!;
    const disconnect = connectInputActions({
      point: (event) => current.current.actions.point(event),
      dwell: (event) => current.current.actions.dwell(event),
      select: (event) => {
        if (event.source !== 'mouse' && activateInputControl(event, target.ownerDocument)) return;
        return current.current.actions.select(event);
      },
      plant: (event) => current.current.actions.plant(event),
      resize: (event) => current.current.actions.resize(event),
      confirm: (event) => current.current.actions.confirm(event),
      dismiss: (event) => current.current.actions.dismiss(event),
    }, (error) => current.current.onError(error), bus);
    const removeMouse = attachMouseInput(target, bus);
    return () => { removeMouse(); disconnect(); };
  }, [bus]);
  return <div ref={surface}>{children}<InputControls {...controls} bus={bus} /></div>;
}
