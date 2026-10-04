// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';

const observed = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock('../api', () => ({ api: {}, usingMocks: true }));
vi.mock('../api/mocks', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/mocks')>();
  return { ...original, createMockApi: (...args: Parameters<typeof original.createMockApi>) => {
    const api = original.createMockApi(...args);
    return { ...api, ask: (request: Parameters<typeof api.ask>[0]) => { observed.ask(request); return api.ask(request); } };
  } };
});
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); vi.clearAllMocks(); });

it('sends the live transcript so far with meeting/account scope through the shared API', async () => {
  window.history.replaceState({}, '', '/?meetingId=ask-session&accountId=client-account');
  const user = userEvent.setup(); render(<App />);
  await user.click(screen.getByRole('button', { name: 'Play fixture transcript' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Play fixture transcript' })).not.toHaveProperty('disabled', true));
  await user.type(screen.getByLabelText('Your question'), 'checklist');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  expect(observed.ask).toHaveBeenCalledWith(expect.objectContaining({
    accountId: 'client-account', meetingId: 'ask-session', question: 'checklist',
    recentUtterances: expect.arrayContaining([expect.objectContaining({ meetingId: 'ask-session', via: 'voice' })]),
  }));
  expect(screen.getByRole('button', { name: 'Hold to ask by voice' })).toHaveProperty('disabled', true);
});
