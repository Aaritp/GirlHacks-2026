// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../api/mocks';
import type { OnlineCaptureOptions } from './online';
import { TranscriptPanel } from './TranscriptPanel';

// jsdom has no getDisplayMedia; pretend to be desktop Chrome and record what capture is started with.
const started: OnlineCaptureOptions[] = [];
const mute = vi.hoisted(() => vi.fn());
vi.mock('./capture', async (original) => ({
  ...(await original<typeof import('./capture')>()),
  checkTabCaptureSupport: () => null,
}));
vi.mock('./online', async (original) => ({
  ...(await original<typeof import('./online')>()),
  startOnlineCapture: vi.fn(async (_api: unknown, _callbacks: unknown, options: OnlineCaptureOptions) => {
    started.push(options);
    return { stop: async () => undefined, setMicrophoneMuted: mute };
  }),
}));

const MEETING = 'meet-1';
const NOW = Date.parse('2026-10-03T13:10:00Z');

beforeEach(() => {
  started.length = 0;
  mute.mockClear();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

function seededApi() {
  const api = createMockApi({ seeds: [], roots: [] });
  return { ...api, extract: vi.fn(api.extract) };
}

describe('TranscriptPanel', () => {
  it('mutes meeting mic capture during an assistant question and restores it afterward', async () => {
    const api = seededApi();
    const view = render(<TranscriptPanel api={api} meetingId={MEETING} userName="Prisha" questionActive={false} />);
    fireEvent.click(screen.getByRole('button', { name: /share meeting tab/i }));
    await waitFor(() => expect(started).toHaveLength(1));
    view.rerender(<TranscriptPanel api={api} meetingId={MEETING} userName="Prisha" questionActive />);
    expect(mute).toHaveBeenLastCalledWith(true);
    expect(started[0].isMicrophoneMuted?.()).toBe(true);
    view.rerender(<TranscriptPanel api={api} meetingId={MEETING} userName="Prisha" questionActive={false} />);
    expect(mute).toHaveBeenLastCalledWith(false);
    expect(started[0].isMicrophoneMuted?.()).toBe(false);
  });
  it('uses a shared name and clock from the app when given', async () => {
    const onUserNameChange = vi.fn();
    const startedAt = NOW - 90_000; // the app's meeting began 90 s ago
    render(<TranscriptPanel api={seededApi()} meetingId={MEETING} meetingStartedAt={startedAt}
      userName="Prisha" onUserNameChange={onUserNameChange} />);
    const input = screen.getByLabelText(/your name/i) as HTMLInputElement;
    expect(input.value).toBe('Prisha');
    fireEvent.change(input, { target: { value: 'Prisha S' } });
    expect(onUserNameChange).toHaveBeenCalledWith('Prisha S');
    expect(localStorage.getItem('grovekeeper.userName')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /share meeting tab/i }));
    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({ userName: 'Prisha', baseSec: 90 });
  });

  it('keeps its own remembered name and clock when the app does not share them', async () => {
    render(<TranscriptPanel api={seededApi()} meetingId={MEETING} />);
    const share = screen.getByRole('button', { name: /share meeting tab/i });
    expect(share).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Prisha' } });
    expect(localStorage.getItem('grovekeeper.userName')).toBe('Prisha');
    fireEvent.click(share);
    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({ userName: 'Prisha', baseSec: 0 });
  });

  it('shows the saved transcript after a reload and continues its own clock after it', async () => {
    const api = seededApi();
    await api.saveUtterance({ id: 'u1', meetingId: MEETING, speaker: 'Sam', text: 'Earlier line.', startSec: 41, via: 'voice' });
    localStorage.setItem('grovekeeper.userName', 'Prisha');
    render(<TranscriptPanel api={api} meetingId={MEETING} />);
    expect(await screen.findByText(/Earlier line\./)).toBeTruthy();
    expect(screen.getByText(MEETING)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /share meeting tab/i }));
    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0].baseSec).toBe(42);
  });

  it('leaves a shared clock alone when restoring', async () => {
    const api = seededApi();
    await api.saveUtterance({ id: 'u1', meetingId: MEETING, speaker: 'Sam', text: 'Earlier line.', startSec: 300, via: 'voice' });
    render(<TranscriptPanel api={api} meetingId={MEETING} meetingStartedAt={NOW - 5_000} userName="Prisha" />);
    await screen.findByText(/Earlier line\./);
    fireEvent.click(screen.getByRole('button', { name: /share meeting tab/i }));
    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0].baseSec).toBe(5);
  });

  it('sends the account with extractions and says where things are saved', async () => {
    const api = seededApi();
    render(<TranscriptPanel api={api} meetingId={MEETING} accountId="acct-northwind" />);
    expect(screen.getByText('acct-northwind')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /play fixture transcript/i }));
    await waitFor(() => expect(api.extract).toHaveBeenCalled());
    expect(api.extract.mock.calls[0][0]).toMatchObject({ meetingId: MEETING, accountId: 'acct-northwind' });
  });

  it('asks before marking a commitment done and reloads the forest after Yes', async () => {
    const api = createMockApi({ seeds: [{
      id: 'open-1', meetingId: 'demo-meeting', text: 'Send the payroll integration checklist', owner: 'Alex',
      deadline: null, kind: 'commitment', status: 'sprout', health: 1, sourceType: 'meeting',
      sourceId: 'demo-meeting', timestampSec: 3, lastActivity: '2026-10-01T13:00:00Z', size: 1 }], roots: [] });
    const updateSeed = vi.spyOn(api, 'updateSeed');
    const onSeedsExtracted = vi.fn();
    // The fixture transcript has no "done" line, so feed one through the session via the fixture path.
    const { demoUtterances } = await import('../api/fixtures');
    demoUtterances.push({ id: 'done-1', meetingId: 'demo-meeting', speaker: 'Alex',
      text: 'The payroll integration checklist is done and sent.', startSec: 50, via: 'voice' });
    try {
      render(<TranscriptPanel api={api} meetingId="demo-meeting" onSeedsExtracted={onSeedsExtracted} />);
      fireEvent.click(screen.getByRole('button', { name: /play fixture transcript/i }));
      expect(await screen.findByText(/as done\?/)).toBeTruthy();
      expect(updateSeed).not.toHaveBeenCalled();
      onSeedsExtracted.mockClear();
      fireEvent.click(screen.getByRole('button', { name: /yes, mark done/i }));
      await waitFor(() => expect(updateSeed).toHaveBeenCalledWith('demo-meeting', 'open-1',
        expect.objectContaining({ status: 'bloom' })));
      await waitFor(() => expect(onSeedsExtracted).toHaveBeenCalled());
      expect(screen.queryByText(/as done\?/)).toBeNull();
    } finally {
      demoUtterances.pop();
    }
  });

  it('mutes only Grovekeeper\'s mic on request, because a call app\'s mute cannot reach this tab', async () => {
    render(<TranscriptPanel api={seededApi()} meetingId={MEETING} userName="Prisha" />);
    fireEvent.click(screen.getByRole('button', { name: /share meeting tab/i }));
    await waitFor(() => expect(started).toHaveLength(1));
    expect(screen.getByText(/does not stop Grovekeeper/i)).toBeTruthy();
    expect(started[0].isMicrophoneMuted?.()).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Mute my mic' }));
    await waitFor(() => expect(mute).toHaveBeenLastCalledWith(true));
    expect(started[0].isMicrophoneMuted?.()).toBe(true);
    expect(screen.getByRole('button', { name: 'Unmute my mic' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/nothing you say is transcribed/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Unmute my mic' }));
    await waitFor(() => expect(mute).toHaveBeenLastCalledWith(false));
    expect(started[0].isMicrophoneMuted?.()).toBe(false);
  });
});
