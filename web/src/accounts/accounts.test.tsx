// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/contracts';
import { AccountsApp } from './AccountsApp';
import { createMockAccountsApi, type AccountsData } from './api';
import { createAccountsDemo } from './fixtures';
import { accountSeeds, displayState, summarize } from './state';
import type { Seed } from '../types';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(path: string, data: AccountsData = createAccountsDemo()) {
  window.history.replaceState(null, '', path);
  const api = createMockAccountsApi(data);
  return { api, data, ...render(<AccountsApp api={api} demo />) };
}
const plants = () => [...document.querySelectorAll<HTMLElement>('.account-forest [data-seed-id]')];
const stateOf = (id: string) => document.querySelector<HTMLElement>(`[data-seed-id="${id}"]`)?.dataset.state;
const card = (id: string) => within(document.querySelector<HTMLElement>(`[data-account-id="${id}"]`)!);

describe('account list', () => {
  it('shows each account with its open commitments and risks', async () => {
    setup('/?accounts');
    await waitFor(() => expect(card('acct-northwind').getByText(/open commitments/).textContent).toBe('2 open commitments'));
    expect(card('acct-northwind').getByText(/risk/).textContent).toBe('1 risk');
    expect(card('acct-harbor').getByText(/open commitment/).textContent).toBe('1 open commitment');
    expect(card('acct-harbor').getByText(/risk/).textContent).toBe('1 risk');
    expect(card('acct-juniper').getByText(/open commitments/).textContent).toBe('0 open commitments');
    expect(card('acct-juniper').getByText(/risks/).textContent).toBe('0 risks');
  });

  it('opens the dashboard of the clicked account', async () => {
    setup('/?accounts');
    fireEvent.click(await screen.findByRole('button', { name: /Harbor Health Partners.*open commitment/ }));
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Harbor Health Partners');
    expect(window.location.search).toBe('?account=acct-harbor');
  });

  it('reports a failed list load and never shows zero for counts it could not load', async () => {
    const { api } = setup('/?account=acct-juniper');
    vi.spyOn(api, 'listAccounts').mockRejectedValueOnce(new ApiError(503, 'STORAGE_UNAVAILABLE', 'Storage is temporarily unavailable.'));
    fireEvent.click(await screen.findByRole('button', { name: 'All accounts' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load accounts. Storage is temporarily unavailable.');

    vi.spyOn(api, 'getTimeline').mockImplementation(async (id) => {
      if (id === 'acct-harbor') throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Storage is temporarily unavailable.');
      return { accountId: id, items: [] };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    await waitFor(() => expect(card('acct-harbor').getByText('Counts unavailable')).toBeTruthy());
    expect(card('acct-harbor').queryByText(/open commitment/)).toBeNull();
  });
});

describe('account dashboard', () => {
  it('orders the timeline newest first with one icon per source type', async () => {
    const data = createAccountsDemo();
    data.timelines[0].items.reverse();
    setup('/?account=acct-northwind', data);
    await screen.findByRole('heading', { name: 'Timeline' });
    const items = [...document.querySelectorAll<HTMLElement>('.timeline [data-source-id]')];
    expect(items.map((item) => item.dataset.sourceId)).toEqual(['src-nw-slack', 'src-nw-email', 'src-nw-kickoff', 'src-nw-doc']);
    expect(items.map((item) => item.querySelector<HTMLElement>('.source-icon')!.dataset.sourceType))
      .toEqual(['slack', 'email', 'meeting', 'document']);
    expect(items.map((item) => item.querySelectorAll('svg').length)).toEqual([1, 1, 1, 1]);
  });

  it('shows a source text and the seeds extracted from it', async () => {
    setup('/?account=acct-northwind');
    fireEvent.click(await screen.findByRole('button', { name: /Re: sandbox credentials/ }));
    const detail = within(screen.getByRole('complementary', { name: 'Source details' }));
    expect(document.querySelector('.source-text')!.textContent).toContain('our testers are blocked. If this slips past Friday');
    expect(detail.getByRole('button', { name: 'Send sandbox credentials to Northwind testers' })).toBeTruthy();
    expect(detail.getByRole('button', { name: 'Pilot window missed if credentials slip past Friday' })).toBeTruthy();
    expect(detail.queryByText('Confirm the tax table mapping covers Quebec')).toBeNull();
  });

  it('loads a meeting transcript only when the meeting is opened, in spoken order', async () => {
    const data = createAccountsDemo();
    data.utterances!.reverse();
    const { api } = setup('/?account=acct-northwind', data);
    const read = vi.spyOn(api, 'getUtterances');
    fireEvent.click(await screen.findByRole('button', { name: /Re: sandbox credentials/ }));
    expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Payroll migration kickoff/ }));
    const lines = await within(await screen.findByRole('list', { name: 'Meeting transcript' })).findAllByRole('listitem');
    expect(read).toHaveBeenCalledWith('src-nw-kickoff');
    expect(lines.map((line) => line.textContent)).toEqual([
      '0:12Dana We need the cutover finished before the January pay run.',
      '0:31Alex I will send the integration checklist this week.',
      '0:50Dana Agreed, we go with the phased rollout, hourly staff first.']);
    expect(screen.queryByText(/Time-off balances/)).toBeNull();
  });

  it('reports a transcript that fails to load or was never saved', async () => {
    const data = createAccountsDemo();
    const { api } = setup('/?account=acct-northwind', { ...data, utterances: [] });
    vi.spyOn(api, 'getUtterances').mockRejectedValueOnce(new ApiError(503, 'STORAGE_UNAVAILABLE', 'Storage is temporarily unavailable.'));
    fireEvent.click(await screen.findByRole('button', { name: /Payroll migration kickoff/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load the transcript. Storage is temporarily unavailable.');
    const detail = within(screen.getByRole('complementary', { name: 'Source details' }));
    expect(detail.getByText('I will send the integration checklist this week.').tagName).toBe('BLOCKQUOTE');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No transcript was saved for this meeting.')).toBeTruthy();
  });

  it('traces a seed to its source and quote', async () => {
    setup('/?account=acct-northwind');
    fireEvent.click(await screen.findByRole('button', { name: /Confirm the tax table mapping covers Quebec/ }));
    const detail = within(screen.getByRole('complementary', { name: 'Seed details' }));
    expect(detail.getByText('I will confirm by Thursday.').tagName).toBe('BLOCKQUOTE');
    expect(detail.getByText(/#northwind-rollout/)).toBeTruthy();
    expect(detail.getByText('Sam')).toBeTruthy();
  });

  it('keeps accounts isolated', async () => {
    const data = createAccountsDemo();
    const stray: Seed = { ...data.timelines[1].items[0].seeds[0], id: 'stray' };
    const { api } = setup('/?account=acct-northwind', data);
    await waitFor(() => expect(plants()).toHaveLength(7));
    expect(screen.queryByText(/root-cause summary/)).toBeNull();
    expect(screen.queryByText('Quarterly review')).toBeNull();
    expect((await api.getTimeline('acct-harbor')).items.flatMap((item) => item.seeds).every((seed) => seed.accountId === 'acct-harbor')).toBe(true);
    // Even if a response carried another account's seed or source, it is dropped rather than shown.
    const timeline = await api.getTimeline('acct-northwind');
    timeline.items[0].seeds.push(stray);
    timeline.items.push(structuredClone(data.timelines[1].items[1]));
    expect(accountSeeds(timeline).some((seed) => seed.id === 'stray')).toBe(false);
    expect(summarize(timeline)).toEqual({ openCommitments: 2, risks: 1 });
    await expect(api.getTimeline('acct-missing')).rejects.toMatchObject({ status: 404 });
  });

  it('filters by each seed kind and by owner', async () => {
    setup('/?account=acct-northwind');
    await waitFor(() => expect(plants()).toHaveLength(7));
    const kind = screen.getByLabelText('Kind'), owner = screen.getByLabelText('Owner');
    const ids = () => plants().map((plant) => plant.dataset.seedId).sort();
    fireEvent.change(kind, { target: { value: 'commitment' } });
    expect(ids()).toEqual(['nw-checklist', 'nw-quebec', 'nw-sandbox']);
    fireEvent.change(kind, { target: { value: 'decision' } });
    expect(ids()).toEqual(['nw-phased']);
    fireEvent.change(kind, { target: { value: 'risk' } });
    expect(ids()).toEqual(['nw-pilot-risk']);
    fireEvent.change(kind, { target: { value: 'customer_need' } });
    expect(ids()).toEqual(['nw-bilingual', 'nw-cutover']);
    fireEvent.change(kind, { target: { value: 'all' } });
    fireEvent.change(owner, { target: { value: 'Alex' } });
    expect(ids()).toEqual(['nw-checklist', 'nw-sandbox']);
    fireEvent.change(owner, { target: { value: 'Sam' } });
    expect(ids()).toEqual(['nw-quebec']);
    fireEvent.change(owner, { target: { value: '__unassigned__' } });
    expect(ids()).toEqual(['nw-bilingual', 'nw-cutover', 'nw-phased', 'nw-pilot-risk']);
    fireEvent.change(kind, { target: { value: 'commitment' } });
    expect(screen.getByText('No seeds match these filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(plants()).toHaveLength(7);
  });

  it('shows done seeds blooming and overdue or risk seeds wilting, in the forest and the list', async () => {
    setup('/?account=acct-northwind');
    await waitFor(() => expect(plants()).toHaveLength(7));
    expect(stateOf('nw-checklist')).toBe('blooming');
    expect(stateOf('nw-sandbox')).toBe('wilting');
    expect(stateOf('nw-pilot-risk')).toBe('wilting');
    expect(stateOf('nw-quebec')).toBe('growing');
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    const row = within(document.querySelector<HTMLElement>('tr[data-seed-id="nw-sandbox"]')!);
    expect(row.getByText('Wilting')).toBeTruthy();
    expect(row.getByText('Re: sandbox credentials')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(8);
  });

  it('applies the display rule to deadlines and risks', () => {
    const base = createAccountsDemo().timelines[0].items[0].seeds[0];
    const seed = (patch: Partial<Seed>): Seed => ({ ...base, status: 'sprout', kind: 'commitment', deadline: null, ...patch });
    expect(displayState(seed({ deadline: '2026-10-03' }), '2026-10-03')).toBe('growing');
    expect(displayState(seed({ deadline: '2026-10-02' }), '2026-10-03')).toBe('wilting');
    expect(displayState(seed({ deadline: '2026-10-02', status: 'bloom' }), '2026-10-03')).toBe('blooming');
    expect(displayState(seed({ kind: 'risk' }), '2026-10-03')).toBe('wilting');
    expect(displayState(seed({ kind: 'risk', status: 'bloom' }), '2026-10-03')).toBe('blooming');
    expect(displayState(seed({ status: 'wilted' }), '2026-10-03')).toBe('growing');
  });

  it('shows an empty account honestly', async () => {
    setup('/?account=acct-juniper');
    expect(await screen.findByText('Nothing planted yet.')).toBeTruthy();
    expect(screen.getByText('No conversations yet.')).toBeTruthy();
    expect(screen.getByText(/0 open commitments/)).toBeTruthy();
  });

  it('reports a failed load and recovers on retry', async () => {
    window.history.replaceState(null, '', '/?account=acct-northwind');
    const api = createMockAccountsApi(createAccountsDemo());
    vi.spyOn(api, 'getTimeline').mockRejectedValueOnce(new ApiError(503, 'STORAGE_UNAVAILABLE', 'Storage is temporarily unavailable.'));
    render(<AccountsApp api={api} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not load this account. Storage is temporarily unavailable.'));
    expect(plants()).toHaveLength(0);
    expect(screen.queryByText('Nothing planted yet.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    await waitFor(() => expect(plants()).toHaveLength(7));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('blooms a seed on screen when its status changes elsewhere', async () => {
    const { api } = setup('/?account=acct-northwind');
    await waitFor(() => expect(stateOf('nw-quebec')).toBe('growing'));
    const seed = (await api.getTimeline('acct-northwind')).items.flatMap((item) => item.seeds).find((item) => item.id === 'nw-quebec')!;
    await api.setSeedStatus(seed, 'bloom');
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(stateOf('nw-quebec')).toBe('blooming'));
  });

  it('never shows an unsaved change as saved', async () => {
    const { api } = setup('/?account=acct-northwind');
    fireEvent.click(await screen.findByRole('button', { name: /Confirm the tax table mapping covers Quebec/ }));
    vi.spyOn(api, 'setSeedStatus').mockRejectedValueOnce(new Error('Offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Change was not saved. Offline');
    expect(stateOf('nw-quebec')).toBe('growing');
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(stateOf('nw-quebec')).toBe('blooming'));
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy();
  });

  it('shows where a commitment was completed, and clears it on reopening', async () => {
    const { api } = setup('/?account=acct-northwind');
    fireEvent.click(await screen.findByRole('button', { name: /Send the integration checklist/ }));
    const evidence = within(screen.getByRole('region', { name: 'Completion evidence' }));
    expect(evidence.getByText('Checklist went out yesterday.').tagName).toBe('BLOCKQUOTE');
    expect(evidence.getByText(/#northwind-rollout/)).toBeTruthy();
    fireEvent.click(evidence.getByRole('button', { name: 'Read where it was completed' }));
    expect(within(screen.getByRole('complementary', { name: 'Source details' })).getByText(/Checklist went out yesterday/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(stateOf('nw-checklist')).not.toBe('blooming'));
    expect(screen.queryByRole('region', { name: 'Completion evidence' })).toBeNull();
    const stored = (await api.getTimeline('acct-northwind')).items.flatMap((item) => item.seeds).find((seed) => seed.id === 'nw-checklist')!;
    expect(stored.completedBy).toBeNull();
    // Marking done by hand records no evidence, so none is claimed.
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(stateOf('nw-checklist')).toBe('blooming'));
    expect(screen.queryByRole('region', { name: 'Completion evidence' })).toBeNull();
  });

  it('links a new meeting to the open account', async () => {
    setup('/?account=acct-harbor');
    const link = await screen.findByRole('link', { name: 'Start a meeting' });
    const target = new URLSearchParams(link.getAttribute('href')!);
    expect(target.get('accountId')).toBe('acct-harbor');
    expect(target.get('meetingId')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('marks the Ask the Grove slot and scopes it to the account', async () => {
    window.history.replaceState(null, '', '/?account=acct-harbor');
    render(<AccountsApp api={createMockAccountsApi(createAccountsDemo())} renderAsk={(id) => <p>Ask about {id}</p>} />);
    const mounted = await screen.findByText('Ask about acct-harbor');
    const slot = mounted.closest<HTMLElement>('.ask-slot')!;
    expect(slot.dataset.accountId).toBe('acct-harbor');
    expect(screen.queryByText(/not connected yet/)).toBeNull();
  });
});
