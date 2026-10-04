import { useEffect, useId, useRef, useState } from 'react';
import type { GroveApi } from '../api/contracts';
import type { AccountsApi } from '../accounts/api';
import type { Citation, Source, Utterance } from '../types';
import { citationLabel, timeLabel } from './context';

export function SourceEvidence({ citation, api, accountsApi, recentUtterances = [], onClose }: {
  citation: Citation; api: Pick<GroveApi, 'getUtterances'>;
  accountsApi: Pick<AccountsApi, 'getTimeline'>; recentUtterances?: Utterance[]; onClose(): void;
}) {
  const heading = useId();
  const panel = useRef<HTMLElement>(null);
  const target = useRef<HTMLLIElement>(null);
  const [loaded, setLoaded] = useState<{ lines?: Utterance[]; source?: Source }>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const local = useRef(recentUtterances);
  local.current = recentUtterances;
  const isMeeting = citation.sourceType === 'meeting' || citation.sourceType === 'leaves';
  useEffect(() => {
    let current = true;
    setLoaded(undefined); setError(''); panel.current?.focus();
    async function load() {
      try {
        if (isMeeting) {
          const { utterances } = await api.getUtterances(citation.meetingId);
          const lines = new Map(utterances.filter((line) => line.meetingId === citation.meetingId).map((line) => [line.id, line]));
          for (const line of local.current) if (line.meetingId === citation.meetingId) lines.set(line.id, line);
          if (current) setLoaded({ lines: [...lines.values()].sort((a, b) => a.startSec - b.startSec) });
        } else {
          if (!citation.accountId) throw new Error('This citation has no account link. The cited excerpt is shown below.');
          const timeline = await accountsApi.getTimeline(citation.accountId);
          const source = timeline.items.find(({ source }) => source.id === citation.sourceId
            && source.meetingId === citation.meetingId && source.accountId === citation.accountId)?.source;
          if (!source) throw new Error('The source is no longer available in this account.');
          if (current) setLoaded({ source });
        }
      } catch (reason) {
        if (current) setError(reason instanceof Error ? reason.message : 'Could not open the source.');
      }
    }
    void load();
    return () => { current = false; };
  }, [api, accountsApi, citation, isMeeting, retry]);
  const lines = loaded?.lines ?? [];
  const matched = lines.find((line) => citation.timestampSec != null && line.startSec === citation.timestampSec)
    ?? lines.find((line) => line.text.includes(citation.quote))
    ?? (citation.timestampSec == null ? undefined : [...lines].sort((a, b) =>
      Math.abs(a.startSec - citation.timestampSec!) - Math.abs(b.startSec - citation.timestampSec!))[0]);
  useEffect(() => {
    if (loaded) target.current?.scrollIntoView?.({ block: 'nearest' });
  }, [loaded]);
  return <section className="ask-source" ref={panel} tabIndex={-1} aria-labelledby={heading}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <div className="ask-heading"><h3 id={heading}>{citationLabel(citation)}</h3>
      <button type="button" onClick={onClose}>Close source</button></div>
    <blockquote>{citation.quote}</blockquote>
    {!loaded && !error && <p role="status">Opening source…</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry opening source</button></p>}
    {loaded?.source && <div className="ask-source-text">{loaded.source.text || 'The source has no stored text.'}</div>}
    {loaded?.lines && (lines.length ? <ol className="ask-transcript" aria-label="Source transcript">
      {lines.map((line) => <li key={line.id} ref={line.id === matched?.id ? target : undefined}
        aria-current={line.id === matched?.id ? 'location' : undefined}>
        <time>{timeLabel(line.startSec)}</time> <strong>{line.speaker}</strong>: {line.text}
      </li>)}
    </ol> : <p>No transcript lines are available. The cited excerpt is shown above.</p>)}
    {citation.accountId && <a href={`?account=${encodeURIComponent(citation.accountId)}`}>Open client account</a>}
  </section>;
}
