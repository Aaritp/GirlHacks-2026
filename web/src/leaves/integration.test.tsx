// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';

vi.mock('../api', () => ({ api: {}, usingMocks: true }));
vi.mock('./speech', () => ({
  azureSpeechOutput: () => ({
    prepare: vi.fn(async () => ({
      start: async (onStarted: () => void) => { onStarted(); },
      cancel: vi.fn(),
    })),
  }),
}));

afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); });

it('the integrated app saves Leaves into the visible forest and keeps forest confirmation separate', async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('button', { name: 'Mark complete' });
  expect(screen.queryByRole('button', { name: 'Start listening' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Bring in a whiteboard' })).toBeNull();
  expect(screen.getByText(/Online meeting capture.*awaiting integration/)).toBeTruthy();

  const preview = screen.getByLabelText('Editable sentence preview');
  await user.type(preview, 'I will validate Quetzal-Z88.');
  await user.click(screen.getByRole('button', { name: 'Confirm this exact preview' }));
  // Leaves confirmation must not dispatch the forest's "mark as decision" event.
  expect(screen.getByRole('button', { name: 'Mark as a decision' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Speak confirmed preview' }));
  await screen.findByRole('button', { name: /I will validate Quetzal-Z88.*Planted.*Alex/i });
  await screen.findByText('Spoken contribution saved.');
  expect((screen.getByRole('button', { name: 'Speak confirmed preview' }) as HTMLButtonElement).disabled).toBe(true);
});

it('the meeting query is shared by transcript and Leaves; custom meetings stay isolated', async () => {
  window.history.replaceState({}, '', '/?meetingId=client-session-b');
  render(<App />);
  await screen.findByText('A new beginning.');
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Editable sentence preview'), 'I will review account-B onboarding.');
  await user.click(screen.getByRole('button', { name: 'Confirm this exact preview' }));
  await user.click(screen.getByRole('button', { name: 'Speak confirmed preview' }));
  await screen.findByRole('button', { name: /I will review account-B onboarding.*Planted.*Alex/i });
  await waitFor(() => expect(screen.getAllByText(/Meeting client-session-b/).length).toBeGreaterThan(0));
});
