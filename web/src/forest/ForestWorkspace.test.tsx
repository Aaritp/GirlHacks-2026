// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../api/mocks';
import { inputBus } from '../input/inputBus';
import { ForestWorkspace } from './ForestWorkspace';
import { createForestDemo } from './demo';

afterEach(() => { cleanup(); localStorage.clear(); });
const meetingId = 'demo-meeting';
function setup() {
  const api = createMockApi(createForestDemo());
  const props = { api, meetingId, meetingTitle: 'Test meeting', demo: true };
  const view = render(<ForestWorkspace {...props} />);
  return { api, props, ...view };
}

describe('forest interactions', () => {
  it('records progress directly from the garden and only blooms after a successful save', async () => {
    const { api } = setup();
    // First render in the file also pays for module and image setup; allow more than the default second.
    await screen.findByRole('button', { name: 'Mark complete' }, { timeout: 5000 });
    const seed = (await api.getGrove(meetingId)).seeds[0];
    fireEvent.click(screen.getByRole('button', { name: `Record progress for ${seed.text}` }));
    await waitFor(async () => expect((await api.getGrove(meetingId)).seeds[0].status).toBe('sprout'));
    await waitFor(() => expect(screen.getByRole('button', { name: `Complete ${seed.text}` }).hasAttribute('disabled')).toBe(false));
    vi.spyOn(api, 'updateSeed').mockRejectedValueOnce(new Error('Offline'));
    fireEvent.click(screen.getByRole('button', { name: `Complete ${seed.text}` }));
    await screen.findByRole('alert');
    expect((await api.getGrove(meetingId)).seeds[0].status).toBe('sprout');
    expect(screen.queryByText('A promise kept')).toBeNull();
  });

  it('remembers keyboard arrangement on this device without changing seed health or activity', async () => {
    const { api, props, unmount } = setup();
    await screen.findByRole('button', { name: 'Mark complete' });
    const seed = (await api.getGrove(meetingId)).seeds[0];
    const write = vi.spyOn(api, 'updateSeed');
    fireEvent.click(screen.getByRole('button', { name: 'Arrange' }));
    const plant = document.querySelector<HTMLButtonElement>(`[data-seed-id="${seed.id}"]`)!;
    fireEvent.keyDown(plant, { altKey: true, key: 'ArrowRight' });
    const left = plant.parentElement!.style.left;
    expect(JSON.parse(localStorage.getItem(`grovekeeper:layout:${meetingId}`)!)[seed.id][0]).toBe(20);
    expect(write).not.toHaveBeenCalled();
    expect((await api.getGrove(meetingId)).seeds[0]).toEqual(seed);
    unmount();
    render(<ForestWorkspace {...props} />);
    await screen.findByRole('button', { name: 'Mark complete' });
    expect(document.querySelector(`[data-seed-id="${seed.id}"]`)!.parentElement!.style.left).toBe(left);
    fireEvent.click(screen.getByRole('button', { name: 'Arrange' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset plant arrangement' }));
    expect(JSON.parse(localStorage.getItem(`grovekeeper:layout:${meetingId}`)!)).toEqual({});
  });

  it('saves completion through the API and restores it on remount', async () => {
    const { api, props, unmount } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark complete' }));
    await screen.findByRole('button', { name: 'Reopen seed' });
    expect((await api.getGrove(meetingId)).seeds[0].status).toBe('bloom');
    unmount();
    render(<ForestWorkspace {...props} />);
    expect(await screen.findByRole('button', { name: 'Reopen seed' })).toBeTruthy();
  });

  it('plants a manual seed with source identity and no invented timestamp', async () => {
    const { api } = setup();
    await screen.findByRole('button', { name: 'Mark complete' });
    fireEvent.click(screen.getByRole('button', { name: 'Plant a seed' }));
    fireEvent.change(screen.getByLabelText('What needs to happen?'), { target: { value: 'Review the integration notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Plant seed' }));
    await screen.findByRole('heading', { name: 'Review the integration notes' });
    const seed = (await api.getGrove(meetingId)).seeds.find((item) => item.text === 'Review the integration notes');
    expect(seed).toMatchObject({ meetingId, sourceId: meetingId, timestampSec: null, status: 'seed', owner: null });
  });

  it('retains saved state and reports failed updates without claiming completion', async () => {
    const { api } = setup();
    await screen.findByRole('button', { name: 'Mark complete' });
    vi.spyOn(api, 'updateSeed').mockRejectedValueOnce(new Error('Connection lost'));
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Changes were not saved');
    expect((await api.getGrove(meetingId)).seeds[0].status).toBe('seed');
    expect(screen.queryByRole('button', { name: 'Reopen seed' })).toBeNull();
  });

  it('handles shared resize and confirmation events without counting resize as activity', async () => {
    const { api } = setup();
    await screen.findByRole('button', { name: 'Mark complete' });
    const activity = (await api.getGrove(meetingId)).seeds[0].lastActivity;
    act(() => inputBus.emit({ type: 'resize', scale: 1.25, source: 'hand' }));
    await waitFor(async () => expect((await api.getGrove(meetingId)).seeds[0].size).toBe(1.25));
    expect((await api.getGrove(meetingId)).seeds[0].lastActivity).toBe(activity);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark complete' }).hasAttribute('disabled')).toBe(false));
    act(() => inputBus.emit({ type: 'confirm', source: 'hand' }));
    await waitFor(async () => expect((await api.getGrove(meetingId)).seeds[0].kind).toBe('decision'));
  });

  it('offers recovery for search with no results and a genuinely empty grove', async () => {
    const { unmount } = setup();
    await screen.findByRole('button', { name: 'Mark complete' });
    fireEvent.change(screen.getByLabelText('Search seeds'), { target: { value: 'no such task' } });
    expect(screen.getByText('No seeds match this view.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all seeds' }));
    expect(screen.queryByText('No seeds match this view.')).toBeNull();
    unmount();
    render(<ForestWorkspace api={createMockApi({ seeds: [], roots: [] })} meetingId="empty" meetingTitle="Empty" />);
    expect(await screen.findByText('A new beginning.')).toBeTruthy();
  });
});
