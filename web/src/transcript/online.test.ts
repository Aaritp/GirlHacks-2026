import { describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../api/mocks';
import { CaptureError, type AudioChannel } from './capture';
import { startOnlineCapture, type OnlineCaptureCallbacks, type OnlineCaptureDeps } from './online';
import { createTranscriptSession } from './session';
import type { LiveTranscriberCallbacks, PushTranscriber, PushTranscriberOptions } from './speech';
import { chromeEnv, meetingStreams } from './testMedia';

const USER = 'Prisha';

function harness({ failChannel }: { failChannel?: AudioChannel } = {}) {
  const media = meetingStreams();
  const events: string[] = [];
  let emit: (channel: AudioChannel, pcm: Int16Array) => void = () => {};
  const speech: Partial<Record<AudioChannel, LiveTranscriberCallbacks>> = {};
  const options: Partial<Record<AudioChannel, PushTranscriberOptions>> = {};
  const written: Record<AudioChannel, number[][]> = { tab: [], mic: [] };
  const transcribers: Partial<Record<AudioChannel, PushTranscriber>> = {};
  let releaseStart: () => void = () => {};
  const gate = new Promise<void>((resolve) => { releaseStart = resolve; });

  const deps: OnlineCaptureDeps = {
    env: chromeEnv(),
    acquire: async () => media.streams,
    startPipeline: async (_streams, onPcm) => {
      emit = onPcm;
      return { stop: async () => { events.push('pipeline.stop'); } };
    },
    startTranscriber: async (_api, callbacks, opts = {}) => {
      const channel: AudioChannel = opts.speaker ? 'mic' : 'tab';
      speech[channel] = callbacks;
      options[channel] = opts;
      // Audio keeps arriving on both channels while the Speech tokens load.
      emit(channel, Int16Array.of(channel === 'tab' ? 1 : 2));
      await gate;
      if (channel === failChannel) throw new Error(`Could not start transcription: ${channel}`);
      const transcriber: PushTranscriber = {
        write: (pcm) => written[channel].push([...pcm]),
        stop: vi.fn(async () => { events.push(`${channel}.stop`); }),
      };
      transcribers[channel] = transcriber;
      return transcriber;
    },
  };
  const callbacks: OnlineCaptureCallbacks = {
    onPartial: vi.fn(), onFinal: vi.fn(), onWarning: vi.fn(),
    onEnded: vi.fn((reason) => { events.push(`ended:${reason}`); }),
  };
  const start = (userName = USER) => {
    const pending = startOnlineCapture(createMockApi(), callbacks, { userName }, deps);
    const ready = () => vi.waitFor(() => expect(Object.keys(speech)).toHaveLength(2));
    return { pending, ready, release: async () => { await ready(); releaseStart(); return pending; } };
  };
  return { media, events, written, transcribers, callbacks, options, start, speech, emit: (c: AudioChannel, pcm: Int16Array) => emit(c, pcm) };
}

describe('startOnlineCapture', () => {
  it('transcribes the mic under the user name and diarizes the tab', async () => {
    const h = harness();
    await h.start().release();
    expect(h.options.mic?.speaker).toBe(USER);
    expect(h.options.tab?.speaker).toBeUndefined();
  });

  it('routes each channel to its own transcriber, including audio buffered during startup', async () => {
    const h = harness();
    await h.start().release();
    h.emit('tab', Int16Array.of(10));
    h.emit('mic', Int16Array.of(20));
    expect(h.written).toEqual({ tab: [[1], [10]], mic: [[2], [20]] });
  });

  it('reports partials and finals with their channel', async () => {
    const h = harness();
    await h.start().release();
    h.speech.mic!.onPartial('I will', USER);
    h.speech.tab!.onFinal({ speaker: 'Guest-1', text: 'Sounds good.', startSec: 3, via: 'voice' });
    expect(h.callbacks.onPartial).toHaveBeenCalledWith('mic', 'I will', USER);
    expect(h.callbacks.onFinal).toHaveBeenCalledWith('tab', expect.objectContaining({ speaker: 'Guest-1' }));
  });

  it('requires a name before opening any picker', async () => {
    const h = harness();
    const acquire = vi.fn();
    await expect(startOnlineCapture(createMockApi(), h.callbacks, { userName: '  ' }, { acquire }))
      .rejects.toThrow(/Enter your name/);
    expect(acquire).not.toHaveBeenCalled();
  });

  it('ends cleanly when the user stops sharing: audio first, then both transcribers, then onEnded', async () => {
    const h = harness();
    await h.start().release();
    h.media.tab.tracks[0].end();
    await vi.waitFor(() => expect(h.callbacks.onEnded).toHaveBeenCalled());
    expect(h.events[0]).toBe('pipeline.stop');
    expect(h.events.slice(1, 3).sort()).toEqual(['mic.stop', 'tab.stop']);
    expect(h.events[3]).toBe('ended:share-ended');
    expect(h.callbacks.onEnded).toHaveBeenCalledWith('share-ended', expect.stringMatching(/stopped sharing/));
    expect(h.media.tab.allStopped && h.media.mic.allStopped).toBe(true);
  });

  it('ends everything when either transcriber is cancelled or the mic disconnects', async () => {
    const speech = harness();
    await speech.start().release();
    speech.speech.mic!.onCanceled('Speech stopped: WebSocket closed');
    await vi.waitFor(() => expect(speech.callbacks.onEnded).toHaveBeenCalledWith(
      'speech-error', 'Speech stopped: WebSocket closed Share the meeting tab again to continue.'));
    expect(speech.transcribers.tab!.stop).toHaveBeenCalled();

    const mic = harness();
    await mic.start().release();
    mic.media.mic.tracks[0].end();
    await vi.waitFor(() => expect(mic.callbacks.onEnded).toHaveBeenCalledWith('mic-ended', expect.stringMatching(/microphone disconnected/)));
  });

  it('stop() releases everything once, however many times it is called', async () => {
    const h = harness();
    const capture = await h.start().release();
    await Promise.all([capture.stop(), capture.stop()]);
    h.media.tab.tracks[0].end();
    expect(h.transcribers.tab!.stop).toHaveBeenCalledTimes(1);
    expect(h.transcribers.mic!.stop).toHaveBeenCalledTimes(1);
    expect(h.callbacks.onEnded).toHaveBeenCalledTimes(1);
    expect(h.callbacks.onEnded).toHaveBeenCalledWith('stopped', null);
  });

  it('releases the other transcriber, tab and mic if one transcriber cannot start', async () => {
    const h = harness({ failChannel: 'mic' });
    await expect(h.start().release()).rejects.toThrow('Could not start transcription: mic');
    expect(h.transcribers.tab!.stop).toHaveBeenCalled();
    expect(h.media.tab.allStopped && h.media.mic.allStopped).toBe(true);
    expect(h.callbacks.onEnded).not.toHaveBeenCalled();
  });

  it('handles the share being stopped while Speech is still starting', async () => {
    const h = harness();
    const { pending, ready, release } = h.start();
    await ready();
    h.media.tab.tracks[1].end();
    await expect(release()).rejects.toThrow(/Sharing stopped before transcription started/);
    await pending.catch(() => undefined);
    expect(h.transcribers.tab!.stop).toHaveBeenCalled();
    expect(h.transcribers.mic!.stop).toHaveBeenCalled();
    expect(h.media.mic.allStopped).toBe(true);
  });

  it('passes capture errors through unchanged', async () => {
    const h = harness();
    const error = new CaptureError('no-tab-audio');
    await expect(startOnlineCapture(createMockApi(), h.callbacks, { userName: USER }, {
      env: chromeEnv(), acquire: async () => { throw error; },
    })).rejects.toBe(error);
  });
});

describe('online capture with the transcript session', () => {
  it('saves named utterances from both channels and runs the final extraction when the share ends', async () => {
    const backing = createMockApi({ seeds: [], roots: [] });
    const api = { ...backing, saveUtterance: vi.fn(backing.saveUtterance), extract: vi.fn(backing.extract) };
    let n = 0;
    const session = createTranscriptSession({ api, meetingId: 'meet-1', newId: () => `u${++n}` });
    const h = harness();
    // Wire the callbacks the way TranscriptPanel does.
    h.callbacks.onFinal = (_channel, segment) => { void session.add(segment); };
    h.callbacks.onEnded = vi.fn(() => { void session.flush(); });
    await h.start().release();
    h.speech.mic!.onFinal({ speaker: USER, text: "I'll send the deck by Friday.", startSec: 4, via: 'voice' });
    h.speech.tab!.onFinal({ speaker: 'Guest-1', text: 'We decided to ship on Monday.', startSec: 9, via: 'voice' });
    h.media.tab.tracks[0].end();
    await vi.waitFor(() => expect(api.extract).toHaveBeenCalledTimes(1));
    expect(api.saveUtterance.mock.calls.map(([u]) => u.speaker)).toEqual([USER, 'Guest-1']);
    expect(api.extract.mock.calls[0][0].utterances.map((u) => u.id)).toEqual(['u1', 'u2']);
    await vi.waitFor(() => expect(session.snapshot().seeds).toHaveLength(2));
  });
});
