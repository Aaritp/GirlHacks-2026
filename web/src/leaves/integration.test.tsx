// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { startOnlineCapture } from '../transcript/online';

const observed = vi.hoisted(() => ({ save: vi.fn(), extract: vi.fn(), ask: vi.fn() }));
vi.mock('../api/mocks', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/mocks')>();
  return { ...original, createMockApi: (...args: Parameters<typeof original.createMockApi>) => {
    const api = original.createMockApi(...args);
    return { ...api, saveUtterance: (utterance: Parameters<typeof api.saveUtterance>[0]) => {
      observed.save(utterance);
      return api.saveUtterance(utterance);
    }, extract: (request: Parameters<typeof api.extract>[0]) => {
      observed.extract(request);
      return api.extract(request);
    }, ask: (request: Parameters<typeof api.ask>[0]) => {
      observed.ask(request);
      return api.ask(request);
    } };
  } };
});
vi.mock('../transcript/capture', () => ({
  browserEnvironment: () => ({}), checkTabCaptureSupport: () => null,
}));
vi.mock('../transcript/online', () => ({
  startOnlineCapture: vi.fn(async () => ({ stop: vi.fn(async () => {}) })),
}));

vi.mock('../api', () => ({ api: {}, usingMocks: true }));
vi.mock('./speech', () => ({
  azureSpeechOutput: () => ({
    prepare: vi.fn(async () => ({
      start: async (onStarted: () => void) => { onStarted(); },
      cancel: vi.fn(),
    })),
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
});

it('the integrated app saves Leaves into the visible forest and keeps forest confirmation separate', async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('button', { name: 'Mark complete' });
  expect(screen.getByRole('button', { name: 'Share meeting tab' })).toBeTruthy();
  expect(screen.queryByLabelText('Editable sentence preview')).toBeNull();
  await user.type(screen.getByLabelText('Your name'), 'Alex');

  const preview = screen.getByLabelText('Editable sentence preview');
  await user.type(preview, 'I will validate Quetzal-Z88.');
  await user.click(screen.getByRole('button', { name: 'Confirm this exact preview' }));
  // Leaves confirmation must not dispatch the forest's "mark as decision" event.
  expect(screen.getByRole('button', { name: 'Mark as a decision' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Speak confirmed preview' }));
  await screen.findByRole('button', { name: /I will validate Quetzal-Z88.*Planted.*Alex/i });
  await screen.findByText('Spoken contribution saved.');
  expect((screen.getByRole('button', { name: 'Speak confirmed preview' }) as HTMLButtonElement).disabled).toBe(true);
  await user.type(screen.getByLabelText('Your question'), 'Quetzal-Z88');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  expect(observed.ask).toHaveBeenCalledWith(expect.objectContaining({
    recentUtterances: expect.arrayContaining([expect.objectContaining({ via: 'leaves', text: 'I will validate Quetzal-Z88.' })]),
  }));
});

it('the meeting query is shared by transcript and Leaves; custom meetings stay isolated', async () => {
  window.history.replaceState({}, '', '/?meetingId=client-session-b');
  render(<App />);
  await screen.findByText('A new beginning.');
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Your name'), 'Sam');
  await user.type(screen.getByLabelText('Editable sentence preview'), 'I will review account-B onboarding.');
  await user.click(screen.getByRole('button', { name: 'Confirm this exact preview' }));
  await user.click(screen.getByRole('button', { name: 'Speak confirmed preview' }));
  await screen.findByRole('button', { name: /I will review account-B onboarding.*Planted.*Sam/i });
  await waitFor(() => expect(screen.getAllByText(/Meeting client-session-b/).length).toBeGreaterThan(0));
});

it('shares the named participant, API and meeting clock with online capture and persisted Leaves speech', async () => {
  window.history.replaceState({}, '', '/?meetingId=shared-clock-session');
  const now = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
  const user = userEvent.setup();
  render(<App />);
  await user.type(screen.getByLabelText('Your name'), 'Ria');
  now.mockReturnValue(1700000042000);
  await user.click(screen.getByRole('button', { name: 'Share meeting tab' }));
  const [api, callbacks, options] = vi.mocked(startOnlineCapture).mock.calls[0];
  expect(options).toMatchObject({ userName: 'Ria', baseSec: 42 });
  await act(async () => callbacks.onFinal('mic', {
    speaker: options.userName, text: 'I will prepare the agenda.', startSec: options.baseSec!,
  }));
  await waitFor(() => expect(observed.save).toHaveBeenCalledWith(expect.objectContaining({
    meetingId: 'shared-clock-session', speaker: 'Ria', startSec: 42, via: 'voice',
  })));
  await user.type(screen.getByLabelText('Editable sentence preview'), 'I will review Quetzal-X9.');
  await user.click(screen.getByRole('button', { name: 'Confirm this exact preview' }));
  now.mockReturnValue(1700000045000);
  await user.click(screen.getByRole('button', { name: 'Speak confirmed preview' }));
  await screen.findByText('Spoken contribution saved.');
  expect(observed.save).toHaveBeenCalledWith(expect.objectContaining({
    meetingId: 'shared-clock-session', speaker: 'Ria', startSec: 45, via: 'leaves',
  }));
  const saved = await (api as import('../api/contracts').GroveApi).getUtterances('shared-clock-session');
  expect(saved.utterances.map(({ via, startSec }) => ({ via, startSec }))).toEqual([
    { via: 'voice', startSec: 42 }, { via: 'leaves', startSec: 45 },
  ]);
});

it('changing the shared name clears the previous participant draft and confirmation', async () => {
  window.history.replaceState({}, '', '/?meetingId=name-change-session');
  const user = userEvent.setup();
  render(<App />);
  const name = screen.getByLabelText('Your name');
  await user.type(name, 'Alex');
  await user.type(screen.getByLabelText('Editable sentence preview'), 'Private draft');
  await user.click(screen.getByRole('button', { name: 'Confirm this exact preview' }));
  await user.clear(name);
  await user.type(name, 'Sam');
  expect((screen.getByLabelText('Editable sentence preview') as HTMLTextAreaElement).value).toBe('');
  expect((screen.getByRole('button', { name: 'Speak confirmed preview' }) as HTMLButtonElement).disabled).toBe(true);
  expect(observed.save).not.toHaveBeenCalled();
});

it('retains the account link when Leaves speaks before the first transcript extraction', async () => {
  window.history.replaceState({}, '', '/?meetingId=leaves-first-session&accountId=client-account');
  const user = userEvent.setup();
  render(<App />);
  expect(screen.getByRole('link', { name: "Back to this meeting's client account" }).getAttribute('href'))
    .toBe('?account=client-account');
  await user.type(screen.getByLabelText('Your name'), 'Ria');
  await user.type(screen.getByLabelText('Editable sentence preview'), 'I will verify the account checklist.');
  await user.click(screen.getByRole('button', { name: 'Confirm this exact preview' }));
  await user.click(screen.getByRole('button', { name: 'Speak confirmed preview' }));
  await screen.findByText('Spoken contribution saved.');
  expect(observed.extract).toHaveBeenCalledWith(expect.objectContaining({
    meetingId: 'leaves-first-session', accountId: 'client-account',
    utterances: [expect.objectContaining({ speaker: 'Ria', via: 'leaves' })],
  }));
  await user.click(screen.getByRole('button', { name: 'Play fixture transcript' }));
  await waitFor(() => expect(observed.extract).toHaveBeenCalledWith(expect.objectContaining({
    meetingId: 'leaves-first-session', accountId: 'client-account',
    utterances: expect.arrayContaining([expect.objectContaining({ via: 'voice' })]),
  })));
});
