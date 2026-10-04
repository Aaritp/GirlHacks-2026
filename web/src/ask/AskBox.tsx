import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api as defaultApi, usingMocks } from '../api';
import { accountsApi as defaultAccountsApi } from '../accounts';
import type { GroveApi } from '../api/contracts';
import type { AccountsApi } from '../accounts/api';
import type { AskResponse, Citation, Utterance } from '../types';
import { citationLabel, meetingContext } from './context';
import { SourceEvidence } from './SourceEvidence';
import { PushToTalk } from './PushToTalk';
import './ask.css';

export interface AskBoxProps {
  api?: Pick<GroveApi, 'ask' | 'getSpeechToken' | 'getUtterances'>;
  accountsApi?: Pick<AccountsApi, 'getTimeline'>;
  accountId?: string | null; meetingId?: string | null; recentUtterances?: Utterance[];
  mockMode?: boolean; voiceEnabled?: boolean;
  /** Optional host source opener. Without one, citations open an inline source reader. */
  onOpenCitation?: (citation: Citation) => void;
  onVoiceActiveChange?: (active: boolean) => void;
}

export function AskBox(props: AskBoxProps) {
  // Scope changes discard questions, answers, microphones and in-flight responses.
  return <ScopedAskBox key={`${props.accountId ?? ''}:${props.meetingId ?? ''}`} {...props} />;
}

function ScopedAskBox({ api = defaultApi, accountsApi = defaultAccountsApi, accountId, meetingId,
  recentUtterances = [], mockMode = usingMocks, voiceEnabled = false, onOpenCitation, onVoiceActiveChange }: AskBoxProps) {
  const id = useId();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AskResponse>();
  const [pending, setPending] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const [citation, setCitation] = useState<Citation>();
  const version = useRef(0);
  const opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => () => { version.current++; }, []);
  const edit = (text: string) => {
    version.current++; setQuestion(text.slice(0, 1000)); setAnswer(undefined);
    setCitation(undefined); setError(''); setPending(false);
  };
  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || pending || listening) return;
    const ticket = ++version.current;
    setPending(true); setAnswer(undefined); setCitation(undefined); setError('');
    try {
      const result = await api.ask({ question: question.trim(), accountId, meetingId,
        recentUtterances: meetingContext(recentUtterances, meetingId) });
      if (ticket === version.current) setAnswer(result);
    } catch (reason) {
      if (ticket === version.current) setError(reason instanceof Error ? reason.message : 'Could not ask the grove. Please try again.');
    } finally { if (ticket === version.current) setPending(false); }
  }
  return <section className="ask-box" aria-labelledby={`${id}-heading`}>
    <div className="ask-heading"><div><p className="ask-eyebrow">Answers with evidence</p>
      <h2 id={`${id}-heading`}>Ask the Grove</h2></div><span className="ask-scope">{meetingId ? 'Meeting context' : accountId ? 'This client account' : 'Your grove'}</span></div>
    <p className="ask-hint">Ask about commitments, decisions or what was discussed. Open a citation to check its source.</p>
    {mockMode && <p className="ask-demo">Demo mode · keyword answers, not AI. Voice questions require configured Speech.</p>}
    <form onSubmit={(event) => { void ask(event); }}>
      <label htmlFor={`${id}-question`}>Your question</label>
      <textarea id={`${id}-question`} value={question} maxLength={1000} rows={2}
        disabled={listening} onChange={(event) => edit(event.target.value)} placeholder="What did we promise this client?" />
      <div className="ask-actions"><button className="button primary" type="submit" disabled={!question.trim() || pending || listening}>
        {pending ? 'Asking…' : 'Ask'}</button>
        {voiceEnabled && <PushToTalk api={api} disabled={pending || mockMode}
          onListeningChange={(active) => { setListening(active); onVoiceActiveChange?.(active); }} onText={edit} />}
      </div>
    </form>
    {pending && <p role="status">Looking through the grove…</p>}
    {error && <p className="ask-error" role="alert">{error} Your question is kept; choose Ask to retry.</p>}
    {answer && <div className="ask-answer" role="status"><p>{answer.answer}</p></div>}
    {answer?.answered && answer.citations.length > 0 && <div className="ask-citations" aria-label="Answer sources">
      {answer.citations.map((item, index) => <button type="button" key={`${item.sourceId}:${item.timestampSec}:${index}`}
        aria-label={`Open source ${index + 1}: ${citationLabel(item)}`}
        className="ask-citation" onClick={(event) => {
          opener.current = event.currentTarget;
          if (onOpenCitation) onOpenCitation(item);
          else setCitation(item.accountId ? item : { ...item, accountId });
        }}><span>{index + 1}</span>{citationLabel(item)}</button>)}
    </div>}
    {citation && <SourceEvidence citation={citation} api={api} accountsApi={accountsApi}
      recentUtterances={recentUtterances} onClose={() => { setCitation(undefined); opener.current?.focus(); }} />}
  </section>;
}
