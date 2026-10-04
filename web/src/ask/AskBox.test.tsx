// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AskBox } from './AskBox';
import { createMockApi } from '../api/mocks';
import { createMockAccountsApi } from '../accounts/api';
import type { AskResponse, Citation, Utterance } from '../types';

afterEach(cleanup);
const citation: Citation = { sourceId: 'm', sourceType: 'meeting', meetingId: 'm', accountId: 'a',
  quote: 'Send the checklist.', title: 'Kickoff', timestampSec: 42 };
const response: AskResponse = { answer: 'Alex will send the checklist.', answered: true, citations: [citation],
  filters: { accountIds: ['a'], kinds: [], status: 'any', dateFrom: null, dateTo: null, keywords: [] } };
const line = (id: string, startSec = 42, meetingId = 'm'): Utterance => ({ id, startSec, meetingId,
  speaker: 'Alex', text: 'Send the checklist.', via: 'voice' });
function setup() {
  const api = createMockApi({ seeds: [], roots: [] });
  const ask = vi.spyOn(api, 'ask').mockResolvedValue(response);
  const accountsApi = createMockAccountsApi({ accounts: [], timelines: [] });
  return { api, ask, accountsApi };
}
async function submit(text = 'What did Alex promise?') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Your question'), text);
  await user.click(screen.getByRole('button', { name: 'Ask' }));
}

it('sends explicit scopes and the latest 200 unique lines from this meeting only', async () => {
  const s = setup();
  const recent = Array.from({ length: 205 }, (_, i) => line(String(i), i));
  render(<AskBox {...s} accountId="a" meetingId="m" mockMode={false}
    recentUtterances={[...recent, line('204', 204), line('private', 999, 'other')]} />);
  await submit();
  await screen.findByText(response.answer);
  const request = s.ask.mock.calls[0][0];
  expect(request).toMatchObject({ question: 'What did Alex promise?', accountId: 'a', meetingId: 'm' });
  expect(request.recentUtterances).toHaveLength(200);
  expect(request.recentUtterances?.[0].id).toBe('5');
  expect(request.recentUtterances?.every((item) => item.meetingId === 'm')).toBe(true);
});

it('shows an unanswered response verbatim without citation chips, even if citations arrive', async () => {
  const s = setup(); s.ask.mockResolvedValue({ ...response, answered: false, answer: "I don't have that in the grove." });
  render(<AskBox {...s} accountId="a" />);
  await submit();
  expect(await screen.findByText("I don't have that in the grove.")).toBeTruthy();
  expect(screen.queryByLabelText('Answer sources')).toBeNull();
});

it('opens the meeting source at its timestamp and restores focus when closed', async () => {
  const s = setup(); await s.api.saveUtterance(line('early', 1)); await s.api.saveUtterance(line('cited'));
  render(<AskBox {...s} accountId="a" meetingId="m" />);
  await submit();
  const chip = await screen.findByRole('button', { name: 'Open source 1: Kickoff · 0:42' });
  await userEvent.click(chip);
  const transcript = await screen.findByRole('list', { name: 'Source transcript' });
  expect(transcript.querySelector('[aria-current="location"]')?.textContent).toContain('0:42');
  await userEvent.click(screen.getByRole('button', { name: 'Close source' }));
  expect(document.activeElement).toBe(chip);
});

it('opens the stored email text from the cited account, without rendering HTML', async () => {
  const s = setup();
  s.ask.mockResolvedValue({ ...response, citations: [{ ...citation, sourceId: 'email', sourceType: 'email', meetingId: 'email', timestampSec: null }] });
  const accountsApi = createMockAccountsApi({ accounts: [{ id: 'a', name: 'Client', aliases: [], contacts: [], industry: '' }],
    timelines: [{ accountId: 'a', items: [{ source: { id: 'email', meetingId: 'email', accountId: 'a',
      type: 'email', title: 'Kickoff', createdAt: '2026-10-04T00:00:00Z', text: 'Full email <script>example</script>' }, seeds: [] }] }] });
  render(<AskBox {...s} accountsApi={accountsApi} accountId="a" />);
  await submit(); await userEvent.click(await screen.findByRole('button', { name: 'Open source 1: Kickoff' }));
  expect(await screen.findByText('Full email <script>example</script>')).toBeTruthy();
  expect(document.querySelector('script')).toBeNull();
});

it('offers the citation to the host source opener for account-page embedding', async () => {
  const s = setup(); const open = vi.fn();
  render(<AskBox {...s} accountId="a" onOpenCitation={open} />);
  await submit(); await userEvent.click(await screen.findByRole('button', { name: 'Open source 1: Kickoff · 0:42' }));
  expect(open).toHaveBeenCalledWith(citation);
  expect(screen.queryByRole('button', { name: 'Close source' })).toBeNull();
});

it('discards an old account response and question after the account scope changes', async () => {
  const s = setup(); let resolve!: (value: AskResponse) => void;
  s.ask.mockReturnValue(new Promise((done) => { resolve = done; }));
  const view = render(<AskBox {...s} accountId="a" />); await submit();
  view.rerender(<AskBox {...s} accountId="b" />);
  await act(async () => resolve(response));
  expect(screen.queryByText(response.answer)).toBeNull();
  expect((screen.getByLabelText('Your question') as HTMLTextAreaElement).value).toBe('');
});

it('retains the question on API failure and retries without saving contributions', async () => {
  const s = setup(); const save = vi.spyOn(s.api, 'saveUtterance');
  s.ask.mockRejectedValueOnce(new Error('Service unavailable'));
  render(<AskBox {...s} accountId="a" />); await submit();
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Service unavailable'));
  await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
  await screen.findByText(response.answer); expect(s.ask).toHaveBeenCalledTimes(2); expect(save).not.toHaveBeenCalled();
});

it('uses live context when the cited line has not yet been saved', async () => {
  const s = setup(); render(<AskBox {...s} meetingId="m" recentUtterances={[line('pending')]} />);
  await submit(); await userEvent.click(await screen.findByRole('button', { name: 'Open source 1: Kickoff · 0:42' }));
  const transcript = await screen.findByRole('list', { name: 'Source transcript' });
  await waitFor(() => expect(within(transcript).getByText('Alex')).toBeTruthy());
});
