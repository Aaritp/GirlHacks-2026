// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/contracts';
import { ClearAllButton } from './ClearAllButton';

afterEach(cleanup);

function setup(clearAll = vi.fn(async () => ({ deleted: { seeds: 3, utterances: 5 }, keptAccounts: true }))) {
  const onCleared = vi.fn();
  render(<ClearAllButton api={{ clearAll }} onCleared={onCleared} />);
  fireEvent.click(screen.getByRole('button', { name: 'Clear all data…' }));
  return { clearAll, onCleared, confirm: screen.getByRole('button', { name: 'Clear everything' }),
    input: screen.getByLabelText(/Type CLEAR ALL to confirm/) };
}

describe('ClearAllButton', () => {
  it('only clears after the exact phrase is typed, keeping accounts by default', async () => {
    const { clearAll, onCleared, confirm, input } = setup();
    expect(screen.getByText(/cannot be undone/)).toBeTruthy();
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(input, { target: { value: 'clear all' } });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(input, { target: { value: 'CLEAR ALL' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(onCleared).toHaveBeenCalled());
    expect(clearAll).toHaveBeenCalledWith({ confirm: 'CLEAR ALL', keepAccounts: true });
    expect(screen.getByText('Cleared 8 record(s). Reloading…')).toBeTruthy();
  });

  it('can also remove client accounts', async () => {
    const { clearAll, confirm, input } = setup();
    fireEvent.click(screen.getByLabelText(/Also remove client accounts/));
    fireEvent.change(input, { target: { value: 'CLEAR ALL' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(clearAll).toHaveBeenCalledWith({ confirm: 'CLEAR ALL', keepAccounts: false }));
  });

  it('shows the server explanation when clearing is turned off, and does not reload', async () => {
    const refused = vi.fn(async () => {
      throw new ApiError(403, 'CLEAR_DISABLED', 'Clearing is turned off on this server. Set GROVEKEEPER_ALLOW_CLEAR_ALL=true.');
    });
    const { onCleared, confirm, input } = setup(refused);
    fireEvent.change(input, { target: { value: 'CLEAR ALL' } });
    fireEvent.click(confirm);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringMatching(/GROVEKEEPER_ALLOW_CLEAR_ALL/));
    expect(onCleared).not.toHaveBeenCalled();
  });

  it('cancel closes and forgets the typed phrase', () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'CLEAR ALL' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all data…' }));
    expect((screen.getByLabelText(/Type CLEAR ALL to confirm/) as HTMLInputElement).value).toBe('');
  });
});
