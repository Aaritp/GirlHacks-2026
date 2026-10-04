import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleTokenRefresh, TOKEN_REFRESH_MS, TOKEN_RETRY_MS } from './speech';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('scheduleTokenRefresh', () => {
  it('refreshes every 9 minutes, before the 10-minute token expires', async () => {
    const apply = vi.fn();
    const fetchToken = vi.fn().mockResolvedValueOnce('t1').mockResolvedValueOnce('t2');
    scheduleTokenRefresh(fetchToken, apply, vi.fn());
    await vi.advanceTimersByTimeAsync(TOKEN_REFRESH_MS - 1);
    expect(fetchToken).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(TOKEN_REFRESH_MS);
    expect(apply.mock.calls).toEqual([['t1'], ['t2']]);
  });

  it('retries a failed refresh every 30 s within the remaining token lifetime, warning once', async () => {
    const apply = vi.fn();
    const onWarning = vi.fn();
    const fetchToken = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('fresh');
    scheduleTokenRefresh(fetchToken, apply, onWarning);
    await vi.advanceTimersByTimeAsync(TOKEN_REFRESH_MS + 2 * TOKEN_RETRY_MS);
    expect(fetchToken).toHaveBeenCalledTimes(3);
    expect(apply).toHaveBeenCalledWith('fresh');
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning.mock.calls[0][0]).toMatch(/refresh failed \(offline\); retrying/);
    // Recovered: back to the normal 9-minute cadence.
    fetchToken.mockResolvedValue('next');
    await vi.advanceTimersByTimeAsync(TOKEN_RETRY_MS);
    expect(fetchToken).toHaveBeenCalledTimes(3);
  });

  it('stops completely when cancelled, including a refresh already in flight', async () => {
    let resolve!: (token: string) => void;
    const apply = vi.fn();
    const fetchToken = vi.fn(() => new Promise<string>((r) => { resolve = r; }));
    const cancel = scheduleTokenRefresh(fetchToken, apply, vi.fn());
    await vi.advanceTimersByTimeAsync(TOKEN_REFRESH_MS);
    cancel();
    resolve('late');
    await vi.advanceTimersByTimeAsync(TOKEN_REFRESH_MS * 3);
    expect(apply).not.toHaveBeenCalled();
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });
});
