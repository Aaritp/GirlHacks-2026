import { useEffect, useMemo, useState } from 'react';
import type { Account, Citation, Utterance } from '../types';
import type { AccountsApi, AccountTimeline } from '../accounts/api';
import type { GroveApi } from '../api/contracts';
import { mentionedAccounts, timeLabel } from './context';
import { SourceEvidence } from './SourceEvidence';

function AccountCard({ account, line, accountsApi, onDismiss, onCitation }: {
  account: Account; line: Utterance; accountsApi: AccountsApi; onDismiss(): void; onCitation(citation: Citation): void;
}) {
  const [timeline, setTimeline] = useState<AccountTimeline>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setTimeline(undefined); setError('');
    accountsApi.getTimeline(account.id).then((result) => {
      if (current) setTimeline(result);
    }, (reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : 'Could not load this account.'); });
    return () => { current = false; };
  }, [account.id, accountsApi, revision]);
  const items = timeline?.items.filter(({ source }) => source.accountId === account.id) ?? [];
  const open = items.flatMap(({ source, seeds }) => seeds.filter((seed) => seed.accountId === account.id && seed.status !== 'bloom'
    && (seed.kind === 'commitment' || seed.kind === 'risk')).map((seed) => ({ source, seed })))
    .sort((a, b) => Number(b.seed.kind === 'risk') - Number(a.seed.kind === 'risk'));
  return <article className="ask-context-card" aria-label={`Context for ${account.name}`}>
    <div className="ask-heading"><a href={`?account=${encodeURIComponent(account.id)}`}>{account.name}</a>
      <button type="button" aria-label={`Dismiss ${account.name} context`} onClick={onDismiss}>Dismiss</button></div>
    <p className="ask-hint">Mentioned by {line.speaker} at {timeLabel(line.startSec)} · saved account context</p>
    {!timeline && !error && <p role="status">Loading account context…</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setRevision((value) => value + 1)}>Retry context</button></p>}
    {timeline && <><p>{open.filter(({ seed }) => seed.kind === 'commitment').length} open commitments · {open.filter(({ seed }) => seed.kind === 'risk').length} risks</p>
      {open.length ? <ul>{open.slice(0, 3).map(({ source, seed }) => <li key={`${seed.meetingId}:${seed.id}`}>
        <strong>{seed.kind === 'risk' ? 'Risk' : 'Commitment'}:</strong> {seed.text}
        {seed.owner && <span> · {seed.owner}</span>}{seed.deadline && <span> · due {seed.deadline}</span>}
        <button type="button" className="ask-citation" onClick={() => onCitation({
          sourceId: source.id, sourceType: seed.sourceType, meetingId: seed.meetingId,
          accountId: account.id, seedId: seed.id, title: source.title,
          quote: seed.quote ?? '', timestampSec: seed.timestampSec,
        })}>View evidence</button>
      </li>)}</ul> : <p>No saved open commitments or risks.</p>}
      <button type="button" onClick={() => setRevision((value) => value + 1)}>Refresh context</button>
    </>}
  </article>;
}

export function ContextCards({ api, accountsApi, utterances, mockMode }: {
  api: GroveApi; accountsApi: AccountsApi; utterances: Utterance[]; mockMode: boolean;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [dismissed, setDismissed] = useState<Record<string, string>>({});
  const [citation, setCitation] = useState<Citation>();
  useEffect(() => {
    let current = true;
    setError('');
    accountsApi.listAccounts().then((result) => { if (current) setAccounts(result); },
      (reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : 'Could not load client names.'); });
    return () => { current = false; };
  }, [accountsApi, revision]);
  const matches = useMemo(() => mentionedAccounts(accounts, utterances), [accounts, utterances]);
  const visible = matches.filter(({ account, line }) => dismissed[account.id] !== line.id).slice(0, 3);
  return <section className="ask-context" aria-label="Mentioned client context">
    <h3>Client context</h3>
    <p className="ask-hint">Saved context appears when a client name or alias is mentioned in a finalized transcript line.{mockMode && ' Sample accounts in demo mode.'}</p>
    {error && <p role="alert">{error} <button type="button" onClick={() => setRevision((value) => value + 1)}>Retry client names</button></p>}
    {!error && visible.length === 0 && <p className="ask-hint">No client mentions to show yet.</p>}
    <div className="ask-context-grid">{visible.map(({ account, line }) => <AccountCard key={`${account.id}:${line.id}`}
      account={account} line={line} accountsApi={accountsApi} onCitation={setCitation}
      onDismiss={() => setDismissed((current) => ({ ...current, [account.id]: line.id }))} />)}</div>
    {citation && <SourceEvidence citation={citation} api={api} accountsApi={accountsApi}
      recentUtterances={utterances} onClose={() => setCitation(undefined)} />}
  </section>;
}
