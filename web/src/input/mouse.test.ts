import { describe, expect, it, vi } from 'vitest';
import { attachMouseInput } from './mouse';
import { createInputBus } from './inputBus';
import { activateInputControl, domTargetAt } from './targets';

function surface() {
  return Object.assign(new EventTarget(), {
    ownerDocument: { defaultView: { innerWidth: 1000, innerHeight: 500 } },
    closest: vi.fn(() => null),
  });
}
function mouseEvent(type: string, extra: object = {}) {
  return Object.assign(new Event(type), { clientX: 500, clientY: 125, button: 0, detail: 1, pointerType: 'mouse', ...extra });
}
describe('mouse and native keyboard access', () => {
  it('normalizes viewport events, ignores other pointers/buttons and cleans up', () => {
    const target = surface(), bus = createInputBus(), point = vi.fn(), select = vi.fn();
    bus.on('point', point); bus.on('select', select);
    const remove = attachMouseInput(target as unknown as HTMLElement, bus);
    target.dispatchEvent(mouseEvent('pointermove'));
    expect(point).toHaveBeenCalledWith({ type: 'point', x: 0.5, y: 0.25, source: 'mouse' });
    target.dispatchEvent(mouseEvent('pointermove', { pointerType: 'touch' }));
    target.dispatchEvent(mouseEvent('click', { button: 2 }));
    target.dispatchEvent(mouseEvent('click'));
    expect(select).toHaveBeenCalledOnce(); expect(point).toHaveBeenCalledOnce();
    remove(); target.dispatchEvent(mouseEvent('click')); expect(select).toHaveBeenCalledOnce();
  });
  it('leaves native click/keyboard handlers alone and never duplicates them as a bus selection', () => {
    const target = surface(), bus = createInputBus(), select = vi.fn(); bus.on('select', select);
    const remove = attachMouseInput(target as unknown as HTMLElement, bus);
    target.closest.mockReturnValue({} as never);
    const event = mouseEvent('click'); target.dispatchEvent(event);
    target.closest.mockReturnValue(null);
    target.dispatchEvent(mouseEvent('click', { detail: 0 }));
    expect(select).not.toHaveBeenCalled(); expect(event.defaultPrevented).toBe(false); remove();
  });
  it('hit-tests opt-in dwell targets and routes a tracked selection to one native button click', () => {
    const button = { dataset: { groveTarget: 'confirm' }, disabled: false, click: vi.fn(), closest: vi.fn(() => null) };
    const doc = { defaultView: { innerWidth: 1000, innerHeight: 500 },
      elementFromPoint: vi.fn(() => ({ closest: () => button })) } as unknown as Document;
    expect(domTargetAt({ x: 0.5, y: 0.5 }, doc)).toBe('confirm');
    expect(activateInputControl({ x: 0.5, y: 0.5 }, doc)).toBe(true);
    expect(button.click).toHaveBeenCalledOnce();
    button.disabled = true; button.closest.mockReturnValue({} as never);
    expect(domTargetAt({ x: 0.5, y: 0.5 }, doc)).toBeNull();
    activateInputControl({ x: 0.5, y: 0.5 }, doc); expect(button.click).toHaveBeenCalledOnce();
  });
});
