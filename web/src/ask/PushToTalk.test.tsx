// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PushToTalk } from './PushToTalk';
import type { QuestionCallbacks, QuestionRecognition, QuestionRecognizer } from './questionSpeech';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const api = { getSpeechToken: vi.fn() };

it('holds a separate recognizer, then fills an editable question on release without submitting', async () => {
  let callbacks!: QuestionCallbacks;
  const stop = vi.fn(async () => { callbacks.onFinal('What is due Friday?'); });
  const cancel = vi.fn(); const text = vi.fn(); const state = vi.fn();
  const recognize: QuestionRecognizer = vi.fn(async (_, next) => { callbacks = next; return { stop, cancel }; });
  render(<PushToTalk api={api} recognize={recognize} onText={text} onListeningChange={state} />);
  const button = screen.getByRole('button');
  await act(async () => fireEvent.keyDown(button, { key: ' ' }));
  expect(button.textContent).toBe('Release to finish'); expect(text).not.toHaveBeenCalled();
  await act(async () => fireEvent.keyUp(button, { key: ' ' }));
  expect(stop).toHaveBeenCalledOnce(); expect(text).toHaveBeenCalledWith('What is due Friday?');
  expect(state).toHaveBeenLastCalledWith(false); expect(cancel).toHaveBeenCalled();
});

it('releasing during permission/startup aborts and disposes a late recognizer', async () => {
  let signal!: AbortSignal; let resolve!: (recorder: QuestionRecognition) => void;
  const recognize: QuestionRecognizer = vi.fn((_, __, next) => { signal = next; return new Promise<QuestionRecognition>((done) => { resolve = done; }); });
  const text = vi.fn(); const cancel = vi.fn();
  render(<PushToTalk api={api} recognize={recognize} onText={text} />);
  const button = screen.getByRole('button');
  fireEvent.keyDown(button, { key: 'Enter' }); fireEvent.keyUp(button, { key: 'Enter' });
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ cancel, stop: vi.fn(async () => {}) }));
  expect(cancel).toHaveBeenCalledOnce(); expect(text).not.toHaveBeenCalled();
});

it('escape and unmount release the recorder without publishing recognized text', async () => {
  const cancel = vi.fn(); const text = vi.fn();
  const recognize: QuestionRecognizer = vi.fn(async () => ({ cancel, stop: vi.fn(async () => {}) }));
  const view = render(<PushToTalk api={api} recognize={recognize} onText={text} />);
  const button = screen.getByRole('button');
  await act(async () => fireEvent.keyDown(button, { key: ' ' }));
  fireEvent.keyDown(button, { key: 'Escape' }); expect(cancel).toHaveBeenCalledOnce();
  await act(async () => fireEvent.keyDown(button, { key: ' ' }));
  view.unmount(); expect(cancel).toHaveBeenCalledTimes(2); expect(text).not.toHaveBeenCalled();
});

it('permission denial returns to typing with an explicit error', async () => {
  const recognize: QuestionRecognizer = vi.fn(async () => { throw new Error('Microphone permission denied'); });
  render(<PushToTalk api={api} recognize={recognize} onText={vi.fn()} />);
  await act(async () => fireEvent.keyDown(screen.getByRole('button'), { key: ' ' }));
  expect(screen.getByRole('status').textContent).toContain('Microphone permission denied');
  expect(screen.getByRole('button').textContent).toBe('Hold to ask by voice');
});
