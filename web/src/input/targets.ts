import type { Point } from './tracking';

/** Opt-in DOM dwell targets. Canvas forests can provide their own hit-test instead. */
export function domTargetAt(point: Point, doc: Document = document): string | null {
  const view = doc.defaultView;
  if (!view) return null;
  const target = doc.elementFromPoint(point.x * view.innerWidth, point.y * view.innerHeight)
    ?.closest<HTMLElement>('[data-grove-target]');
  if (!target || target.closest('[disabled], [aria-disabled="true"], [inert]')) return null;
  return target.dataset.groveTarget || null;
}

/** Call FIRST in Person C's select handler. Native buttons retain exactly one click path. */
export function activateInputControl(point: Point, doc: Document = document): boolean {
  const view = doc.defaultView;
  if (!view) return false;
  const target = doc.elementFromPoint(point.x * view.innerWidth, point.y * view.innerHeight)
    ?.closest<HTMLButtonElement>('button[data-grove-input-action]');
  if (!target) return false;
  if (!target.disabled) target.click();
  return true;
}
