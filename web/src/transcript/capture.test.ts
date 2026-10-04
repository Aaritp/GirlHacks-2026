import { describe, expect, it, vi } from 'vitest';
import { acquireMeetingStreams, CAPTURE_MESSAGES, checkTabCaptureSupport, watchStreamEnd } from './capture';
import { asStream, chromeEnv, domError, FakeStream, FakeTrack, meetingStreams } from './testMedia';

describe('checkTabCaptureSupport', () => {
  it('accepts desktop Chromium browsers', () => {
    expect(checkTabCaptureSupport(chromeEnv())).toBeNull();
    expect(checkTabCaptureSupport({ ...chromeEnv(), userAgentData: { brands: [{ brand: 'Microsoft Edge' }, { brand: 'Chromium' }] } }))
      .toBeNull();
  });

  it('rejects Firefox and Safari before showing the picker, since they never share tab audio', () => {
    const firefoxOrSafari = { ...chromeEnv(), userAgentData: undefined };
    expect(checkTabCaptureSupport(firefoxOrSafari)?.code).toBe('unsupported-browser');
  });

  it('rejects browsers without getDisplayMedia (mobile) and insecure pages', () => {
    expect(checkTabCaptureSupport({ ...chromeEnv(), mediaDevices: undefined })?.code).toBe('unsupported-browser');
    expect(checkTabCaptureSupport({ ...chromeEnv(), isSecureContext: false })?.code).toBe('insecure-context');
  });

  it('explains how to fix each failure', () => {
    expect(CAPTURE_MESSAGES['unsupported-browser']).toMatch(/Chrome or Edge on a desktop/);
    expect(CAPTURE_MESSAGES['no-tab-audio']).toMatch(/Also share tab audio/);
    expect(CAPTURE_MESSAGES['mic-denied']).toMatch(/Allow the microphone/);
  });
});

describe('acquireMeetingStreams', () => {
  it('asks for the tab (with local playback kept on) before the echo-cancelled mic', async () => {
    const order: string[] = [];
    const { tab, mic } = meetingStreams();
    const getDisplayMedia = vi.fn(async () => { order.push('tab'); return asStream(tab); });
    const getUserMedia = vi.fn(async () => { order.push('mic'); return asStream(mic); });
    const streams = await acquireMeetingStreams(chromeEnv({ getDisplayMedia, getUserMedia }));
    expect(order).toEqual(['tab', 'mic']);
    expect(streams).toEqual({ tab, mic });
    const display = (getDisplayMedia.mock.calls[0] as unknown[])[0] as Record<string, any>;
    expect(display.audio.suppressLocalAudioPlayback).toBe(false);
    expect(display.video.displaySurface).toBe('browser');
    const micOptions = (getUserMedia.mock.calls[0] as unknown[])[0] as Record<string, any>;
    expect(micOptions.audio.echoCancellation).toBe(true);
  });

  it('reports a cancelled picker', async () => {
    const env = chromeEnv({ getDisplayMedia: async () => { throw domError('NotAllowedError'); } });
    await expect(acquireMeetingStreams(env)).rejects.toMatchObject({ code: 'share-cancelled' });
  });

  it('rejects a share without audio (window/screen, or tab audio switched off) and releases it', async () => {
    const videoOnly = new FakeStream([new FakeTrack('video')]);
    const getUserMedia = vi.fn();
    const env = chromeEnv({ getDisplayMedia: async () => asStream(videoOnly), getUserMedia });
    await expect(acquireMeetingStreams(env)).rejects.toMatchObject({ code: 'no-tab-audio' });
    expect(videoOnly.allStopped).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it.each([
    ['NotAllowedError', 'mic-denied'], ['SecurityError', 'mic-denied'],
    ['NotFoundError', 'mic-unavailable'], ['NotReadableError', 'mic-unavailable'],
    ['SomethingElse', 'capture-failed'],
  ])('maps mic %s to %s and stops the already-shared tab', async (name, code) => {
    const { tab } = meetingStreams();
    const env = chromeEnv({
      getDisplayMedia: async () => asStream(tab),
      getUserMedia: async () => { throw domError(name); },
    });
    await expect(acquireMeetingStreams(env)).rejects.toMatchObject({ code });
    expect(tab.allStopped).toBe(true);
  });

  it('refuses unsupported browsers without opening any prompt', async () => {
    const getDisplayMedia = vi.fn();
    await expect(acquireMeetingStreams({ ...chromeEnv({ getDisplayMedia }), userAgentData: undefined }))
      .rejects.toMatchObject({ code: 'unsupported-browser' });
    expect(getDisplayMedia).not.toHaveBeenCalled();
  });
});

describe('watchStreamEnd', () => {
  it('reports the user stopping the share once, even though every tab track ends', () => {
    const { tab, streams } = meetingStreams();
    const onEnd = vi.fn();
    watchStreamEnd(streams, onEnd);
    for (const track of tab.tracks) track.end();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith('share-ended');
  });

  it('reports a disconnected mic and unsubscribes cleanly', () => {
    const { tab, mic, streams } = meetingStreams();
    const onEnd = vi.fn();
    const unwatch = watchStreamEnd(streams, onEnd);
    mic.tracks[0].end();
    expect(onEnd).toHaveBeenCalledWith('mic-ended');
    unwatch();
    expect([...tab.tracks, ...mic.tracks].every((track) => track.listenerCount === 0)).toBe(true);
  });
});
