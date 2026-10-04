import { useEffect, useRef, useState } from 'react';
import type { GroveApi } from '../api/contracts';
import { startQuestionRecognition, type QuestionRecognition, type QuestionRecognizer } from './questionSpeech';

export function PushToTalk({ api, disabled = false, onText, onListeningChange,
  recognize = startQuestionRecognition }: {
  api: Pick<GroveApi, 'getSpeechToken'>; disabled?: boolean; onText(text: string): void;
  onListeningChange?(active: boolean): void; recognize?: QuestionRecognizer;
}) {
  const [phase, setPhase] = useState<'idle' | 'starting' | 'listening' | 'finishing'>('idle');
  const [notice, setNotice] = useState('Hold the button or Space to dictate. Release, review, then choose Ask.');
  const [partial, setPartial] = useState('');
  const state = useRef(phase);
  const attempt = useRef<AbortController | null>(null);
  const recording = useRef<QuestionRecognition | null>(null);
  const words = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const callbacks = useRef({ onText, onListeningChange });
  callbacks.current = { onText, onListeningChange };
  const change = (next: typeof phase) => { state.current = next; setPhase(next); callbacks.current.onListeningChange?.(next !== 'idle'); };
  function cancel(message = 'Dictation canceled. Nothing was submitted.') {
    attempt.current?.abort(); attempt.current = null;
    recording.current?.cancel(); recording.current = null;
    clearTimeout(timer.current); words.current = []; setPartial(''); change('idle'); setNotice(message);
  }
  async function finish() {
    if (state.current === 'starting') { cancel('Released before the microphone was ready. Hold again or type your question.'); return; }
    if (state.current !== 'listening') return;
    const active = attempt.current;
    change('finishing'); clearTimeout(timer.current);
    try {
      await recording.current?.stop();
      if (attempt.current !== active) return;
      const text = words.current.join(' ').trim();
      if (text) callbacks.current.onText(text);
      setNotice(text ? 'Question captured. Review it, then choose Ask.' : 'No words captured. Try again or type your question.');
    } catch {
      if (attempt.current === active) setNotice('Could not finish dictation. Please type your question.');
    } finally {
      if (attempt.current === active) {
        recording.current?.cancel(); recording.current = null; attempt.current = null;
        setPartial(''); change('idle');
      }
    }
  }
  async function begin() {
    if (disabled || state.current !== 'idle') return;
    const active = new AbortController(); attempt.current = active; words.current = [];
    setPartial(''); setNotice('Preparing microphone…'); change('starting');
    try {
      const next = await recognize(api, {
        onPartial: (text) => { if (attempt.current === active) setPartial(text); },
        onFinal: (text) => { if (attempt.current === active) { words.current.push(text); setPartial(words.current.join(' ')); } },
        onError: (message) => { if (attempt.current === active) cancel(message); },
      }, active.signal);
      if (active.signal.aborted || attempt.current !== active) { next.cancel(); return; }
      recording.current = next; change('listening'); setNotice('Listening to your question. Release to finish.');
      timer.current = setTimeout(() => { void finish(); }, 60000);
    } catch (reason) {
      if (attempt.current === active) cancel(reason instanceof Error ? reason.message : 'Could not access the microphone. Type your question instead.');
    }
  }
  useEffect(() => () => {
    attempt.current?.abort(); attempt.current = null; recording.current?.cancel(); clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    const blur = () => cancel();
    const hidden = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  return <div className="ask-voice">
    <button type="button" disabled={disabled} aria-pressed={phase === 'listening'}
      onPointerDown={(event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture?.(event.pointerId); void begin(); }}
      onPointerUp={() => { void finish(); }} onPointerCancel={() => cancel()}
      onLostPointerCapture={() => { if (state.current === 'listening' || state.current === 'starting') cancel(); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (!event.repeat) void begin(); }
      }}
      onKeyUp={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); void finish(); } }}
      onBlur={() => { if (state.current === 'listening' || state.current === 'starting') cancel(); }}>
      {phase === 'starting' ? 'Preparing microphone…' : phase === 'listening' ? 'Release to finish' : phase === 'finishing' ? 'Finishing question…' : 'Hold to ask by voice'}
    </button>
    <span className="ask-hint" role="status">{notice}{partial && <span className="ask-partial">{partial}</span>}</span>
  </div>;
}
