// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../App';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('mounts the Ask box on an account page and asks about that account only', async () => {
  window.history.replaceState(null, '', '/?account=acct-harbor');
  render(<App />);
  const box = await screen.findByRole('region', { name: 'Ask the Grove' });
  expect(box.closest<HTMLElement>('.ask-slot')!.dataset.accountId).toBe('acct-harbor');
  expect(within(box).getByText('This client account')).toBeTruthy();
  expect(screen.queryByText(/not connected yet/)).toBeNull();
  fireEvent.change(within(box).getByLabelText('Your question'), { target: { value: 'What did we promise?' } });
  expect((within(box).getByRole('button', { name: 'Ask' }) as HTMLButtonElement).disabled).toBe(false);
});
