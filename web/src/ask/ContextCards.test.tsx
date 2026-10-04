// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextCards } from './ContextCards';
import { createMockAccountsApi } from '../accounts/api';
import { createMockApi } from '../api/mocks';
import type { Utterance } from '../types';

afterEach(cleanup);
const line: Utterance = { id: 'u', meetingId: 'm', speaker: 'Alex', text: 'NWL needs a review.', startSec: 20, via: 'voice' };
function setup() {
  return { api: createMockApi(), accountsApi: createMockAccountsApi({
    accounts: [{ id: 'a', name: 'Northwind', aliases: ['NWL'], contacts: [], industry: '' }], timelines: [{ accountId: 'a', items: [] }],
  }) };
}
it('loads saved context only after a name is mentioned and allows dismiss until a new mention', async () => {
  const s = setup(); const timeline = vi.spyOn(s.accountsApi, 'getTimeline');
  const view = render(<ContextCards {...s} utterances={[]} mockMode />);
  expect(timeline).not.toHaveBeenCalled();
  view.rerender(<ContextCards {...s} utterances={[line]} mockMode />);
  await screen.findByText('No saved open commitments or risks.'); expect(timeline).toHaveBeenCalledWith('a');
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss Northwind context' }));
  expect(screen.queryByRole('article', { name: 'Context for Northwind' })).toBeNull();
  view.rerender(<ContextCards {...s} utterances={[line, { ...line, id: 'later', startSec: 50 }]} mockMode />);
  expect(await screen.findByRole('article', { name: 'Context for Northwind' })).toBeTruthy();
});
it('shows account-load failure rather than inventing an empty account', async () => {
  const s = setup(); vi.spyOn(s.accountsApi, 'getTimeline').mockRejectedValue(new Error('Storage offline'));
  render(<ContextCards {...s} utterances={[line]} mockMode={false} />);
  expect((await screen.findByRole('alert')).textContent).toContain('Storage offline');
  expect(screen.queryByText('No saved open commitments or risks.')).toBeNull();
});
