// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockApi } from '../api/mocks';
import { inputBus } from '../input/inputBus';
import { LeavesPanel } from './LeavesPanel';

afterEach(cleanup);

function setup() {
  const api = createMockApi();
  const start = vi.fn(async () => {});
  const prepare = vi.fn(async () => ({ start, cancel: vi.fn() }));
  render(<LeavesPanel api={api} meetingId="a" speaker="Alex" getStartSec={() => 5} speech={{ prepare }} />);
  return { user: userEvent.setup(), api, prepare, start };
}

it('supports arbitrary native typing and invalidates confirmation after an edit', async () => {
  const { user, prepare } = setup();
  await user.type(screen.getByLabelText('Spell any word or phrase'), 'Quetzal-X9 résumé 東京');
  await user.click(screen.getByRole('button', { name: 'Add spelling to preview' }));
  expect((screen.getByLabelText('Editable sentence preview') as HTMLTextAreaElement).value).toBe('Quetzal-X9 résumé 東京');
  expect((screen.getByRole('button', { name: 'Speak confirmed preview' }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Confirm this exact preview' }));
  expect(prepare).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText('Editable sentence preview'), '.');
  expect((screen.getByRole('button', { name: 'Speak confirmed preview' }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Confirm this exact preview' }));
  await user.click(screen.getByRole('button', { name: 'Speak confirmed preview' }));
  expect(prepare).toHaveBeenCalledWith('Quetzal-X9 résumé 東京.', expect.any(AbortSignal));
});

it('keyboard Enter/Space confirms and speaks as separate actions', async () => {
  const { user, prepare } = setup();
  await user.type(screen.getByLabelText('Editable sentence preview'), 'I can review the checklist.');
  screen.getByRole('button', { name: 'Confirm this exact preview' }).focus();
  await user.keyboard('{Enter}');
  expect(prepare).not.toHaveBeenCalled();
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Speak confirmed preview' }));
  await user.keyboard(' ');
  expect(prepare).toHaveBeenCalledOnce();
});

it('on-screen Unicode spelling retains repeated characters', async () => {
  const { user } = setup();
  await user.click(screen.getByRole('button', { name: 'Unicode character code' }));
  for (const digit of '6771') await user.click(screen.getByRole('button', { name: digit }));
  await user.click(screen.getByRole('button', { name: 'Insert 東' }));
  await user.click(screen.getByRole('button', { name: 'Add spelling to preview' }));
  expect((screen.getByLabelText('Editable sentence preview') as HTMLTextAreaElement).value).toBe('東');
});

it('legacy global input cannot confirm or speak and OCR is not in the active panel', async () => {
  const { user, prepare } = setup();
  await user.type(screen.getByLabelText('Editable sentence preview'), 'My own words.');
  inputBus.emit({ type: 'confirm', source: 'head' });
  inputBus.emit({ type: 'dwell', source: 'head', x: .5, y: .5, progress: 1 });
  expect(prepare).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: 'Speak confirmed preview' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('Bring in a whiteboard')).toBeNull();
});
