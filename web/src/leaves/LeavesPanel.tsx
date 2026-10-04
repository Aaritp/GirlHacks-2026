import { useEffect, useRef, useState } from 'react';
import type { GroveApi } from '../api/contracts';
import type { Seed, Suggestions } from '../types';
import { createLeavesSession, type LeavesSession, type LeavesSnapshot, type SpeechOutput } from './session';
import { azureSpeechOutput } from './speech';
import './leaves.css';

const INITIAL: LeavesSnapshot = { preview: '', confirmed: false, busy: false,
  composing: false, pending: false, saving: false, message: '', error: '' };
interface Props {
  api: GroveApi; meetingId: string; accountId?: string | null; speaker: string; getStartSec: () => number;
  onSeeds?: (seeds: Seed[]) => void; speech?: SpeechOutput; mockMode?: boolean;
}

/** Key this panel by meeting/speaker so unfinished drafts cannot move between people. */
export function LeavesPanel({ api, meetingId, accountId, speaker, getStartSec, onSeeds,
  speech, mockMode = false }: Props) {
  const session = useRef<LeavesSession | null>(null);
  const callbacks = useRef({ getStartSec, onSeeds });
  callbacks.current = { getStartSec, onSeeds };
  const [state, setState] = useState(INITIAL);
  const [suggestions, setSuggestions] = useState<Suggestions>({ words: [], phrases: [] });
  const [suggestionError, setSuggestionError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [spelling, setSpelling] = useState('');
  const [caps, setCaps] = useState(false);
  const [editPreview, setEditPreview] = useState(false);
  const [unicode, setUnicode] = useState('');
  const [unicodeMode, setUnicodeMode] = useState(false);

  useEffect(() => {
    const current = createLeavesSession({
      api, meetingId, accountId, speaker, speech: speech ?? azureSpeechOutput(api),
      getStartSec: () => callbacks.current.getStartSec(), onChange: setState,
      onSeeds: (seeds) => callbacks.current.onSeeds?.(seeds),
    });
    session.current = current;
    setState(current.snapshot());
    return () => { current.dispose(); session.current = null; };
  }, [api, meetingId, accountId, speaker, speech]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setSuggestionError('');
    api.suggest({ meetingId, recentText: '' }).then(
      (result) => { if (active) setSuggestions(result); },
      (reason: unknown) => { if (active) setSuggestionError(reason instanceof Error ? reason.message : 'Suggestions unavailable.'); },
    ).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, meetingId, refresh]);

  function button(id: string, label: string, action: () => void, disabled = false) {
    return <button key={id} type="button" data-leaves-action={id} disabled={disabled}
      onClick={action}>{label}</button>;
  }
  const append = (text: string) => {
    const current = session.current?.snapshot().preview ?? '';
    if (text.trim()) session.current?.edit(current + (current && !/\s$/.test(current) ? ' ' : '') + text);
  };
  const typeCharacter = (character: string) => {
    if (unicodeMode) setUnicode((value) => (value + character).slice(0, 6));
    else if (editPreview) session.current?.edit((session.current?.snapshot().preview ?? '') + character);
    else setSpelling((value) => (value + character).slice(0, 20000));
  };
  const backspace = () => {
    if (unicodeMode) setUnicode((value) => value.slice(0, -1));
    else if (editPreview) session.current?.edit(Array.from(session.current?.snapshot().preview ?? '').slice(0, -1).join(''));
    else setSpelling((value) => Array.from(value).slice(0, -1).join(''));
  };
  const code = Number.parseInt(unicode, 16);
  const validCode = /^[0-9A-Fa-f]{1,6}$/.test(unicode) && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);

  return <section className="leaves" aria-labelledby="leaves-heading">
    <h2 id="leaves-heading">Whispering Leaves</h2>
    <p>Your words, your voice. Speaking as <strong>{speaker}</strong>.</p>
    {mockMode && <p className="leaves-notice">Demo fixtures: suggestions and extraction are mocked. Azure audio is unavailable in mock mode.</p>}
    <p>Choose words, spell anything, then review and confirm. Nothing speaks automatically.</p>
    <div className="leaves-choices">
      {button('refresh', loading ? 'Loading context…' : 'Refresh meeting suggestions', () => setRefresh((v) => v + 1), loading)}
      {suggestions.words.map((word, i) => button('word-' + i, word, () => append(word)))}
      {suggestions.phrases.map((phrase, i) => button('phrase-' + i, phrase, () => append(phrase)))}
    </div>
    {suggestionError && <p role="alert">{suggestionError} You can still spell and edit your own words.</p>}
    <label>Spell any word or phrase
      <input value={spelling} maxLength={20000} onChange={(e) => setSpelling(e.target.value)}
        placeholder="Names, technical terms, any language…" />
    </label>
    <div className="leaves-choices">
      {button('add-spelling', 'Add spelling to preview', () => { append(spelling); setSpelling(''); }, !spelling.trim())}
      {button('edit-target', editPreview ? 'Keys edit preview · switch to spelling' : 'Keys edit spelling · switch to preview',
        () => setEditPreview((v) => !v))}
      {button('caps', caps ? 'Lowercase keys' : 'Uppercase keys', () => setCaps((v) => !v))}
      {button('unicode-mode', unicodeMode ? 'Return to letter keys' : 'Unicode character code', () => setUnicodeMode((v) => !v))}
    </div>
    {unicodeMode && <label>Unicode code point in hexadecimal (for example 00E9 = é)
      <input value={unicode} maxLength={6} onChange={(e) => setUnicode(e.target.value)} />
      {button('insert-unicode', validCode ? 'Insert ' + String.fromCodePoint(code) : 'Enter a Unicode code',
        () => {
          const character = String.fromCodePoint(code);
          if (editPreview) session.current?.edit((session.current?.snapshot().preview ?? '') + character);
          else setSpelling((v) => v + character);
          setUnicode('');
        }, !validCode)}
    </label>}
    <div className="leaves-keyboard" aria-label="On-screen spelling keyboard">
      {Array.from(unicodeMode ? '0123456789ABCDEF' : (caps ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : 'abcdefghijklmnopqrstuvwxyz') + "0123456789.,?!'-")
        .map((letter) => button('key-' + letter, letter, () => typeCharacter(letter)))}
      {!unicodeMode && button('space', 'Space', () => typeCharacter(' '))}
      {button('backspace', 'Backspace', backspace)}
    </div>
    <label>Editable sentence preview
      <textarea value={state.preview} maxLength={20000} rows={3}
        onChange={(e) => session.current?.edit(e.target.value)} />
    </label>
    <div className="leaves-choices">
      {button('compose', state.composing ? 'Building preview…' : 'Build sentence preview',
        () => { void session.current?.compose([state.preview]); }, !state.preview.trim() || state.composing)}
      {button('clear', 'Clear preview', () => session.current?.edit(''))}
      {button('confirm', state.confirmed ? 'Preview confirmed' : 'Confirm this exact preview',
        () => session.current?.confirm(), !state.preview.trim() || state.busy || state.composing || state.pending)}
      {button('speak', state.busy ? 'Speech in progress…' : 'Speak confirmed preview',
        () => { void session.current?.speak(); }, !state.confirmed || state.busy || state.pending)}
      {button('cancel', 'Cancel speech / confirmation', () => session.current?.cancel())}
      {state.pending && button('retry', state.saving ? 'Saving…' : 'Retry saving (no speech)',
        () => { void session.current?.retrySave(); }, state.saving)}
    </div>
    <p role="status" aria-live="polite">{state.message || 'No preview has been confirmed.'}</p>
    {state.error && <p role="alert">{state.error}</p>}
    <p className="leaves-help">Use your mouse or Tab and Enter/Space.
      Editing cancels confirmation. Drafts are not saved as spoken contributions.</p>
  </section>;
}
