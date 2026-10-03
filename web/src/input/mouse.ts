import { inputBus, type InputBus } from './inputBus';

/** Attach once to an interaction surface; clean up on unmount. Coordinates use the viewport. */
export function attachMouseInput(target: HTMLElement, bus: InputBus = inputBus): () => void {
  const coordinates = (event: PointerEvent | MouseEvent) => {
    const view = target.ownerDocument.defaultView;
    return {
      x: Math.max(0, Math.min(1, event.clientX / Math.max(1, view?.innerWidth ?? 1))),
      y: Math.max(0, Math.min(1, event.clientY / Math.max(1, view?.innerHeight ?? 1))),
      source: 'mouse' as const,
    };
  };
  const point = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') bus.emit({ type: 'point', ...coordinates(event) });
  };
  const select = (event: MouseEvent) => {
    if (event.button === 0) bus.emit({ type: 'select', ...coordinates(event) });
  };
  target.addEventListener('pointermove', point);
  target.addEventListener('click', select);
  return () => {
    target.removeEventListener('pointermove', point);
    target.removeEventListener('click', select);
  };
}
