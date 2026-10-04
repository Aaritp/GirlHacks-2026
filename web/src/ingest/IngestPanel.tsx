import { useEffect, useState, type FormEvent } from 'react';
import type { Account, Followup, IngestApi, IngestResult, IngestSourceType } from './contracts';
import { MAX_TEXT } from './contracts';
import { demoEmail } from './mocks';
import { encodeUpload } from './files';
import './ingest.css';

export function IngestPanel({ api, mock = false, onOpenGrove }: {
  api: IngestApi; mock?: boolean; onOpenGrove?: (meetingId: string, title: string) => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [sourceType, setSourceType] = useState<IngestSourceType>('email');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [channelId, setChannelId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [results, setResults] = useState<IngestResult[]>([]);
  const [draft, setDraft] = useState<Followup | null>(null);
  const [accountRevision, setAccountRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    api.getAccounts().then((items) => {
      if (active) { setAccounts(items); setAccountId(items[0]?.id ?? ''); }
    }, () => { if (active) setError('Could not load accounts. The shared account service must be available before importing.'); });
    return () => { active = false; };
  }, [api, accountRevision]);
  const account = accounts.find((a) => a.id === accountId);
  const run = async (label: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(label); setError(''); setNotice('');
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Request failed. Try again.'); }
    finally { setBusy(''); }
  };
  const addResults = (added: IngestResult[]) => setResults((old) => {
    const map = new Map(old.map((item) => [item.source.id, item]));
    added.forEach((item) => map.set(item.source.id, item));
    return [...map.values()];
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run('Importing…', async () => {
      if (text.length > MAX_TEXT) throw new Error('Use at most 100,000 characters.');
      const content = file ? { filename: file.name, fileBase64: await encodeUpload(file) } : { text };
      const result = await api.ingest({ accountId, sourceType, title, ...content });
      addResults([result]); setNotice(result.seeds.length + ' seeds saved to ' + account?.name + '.');
    });
  };
  return <main className="ingest-panel">
    <header><p className="ingest-eyebrow">Grovekeeper · Conversations to commitments</p>
      <h1>Add to grove</h1><p>Bring emails, chats and documents into the right client account.</p>
      {mock && <p className="ingest-notice">Demo mode: fixture extraction and Slack messages, not live AI or Slack. Data resets on reload.</p>}
    </header>
    {error && <p role="alert" className="ingest-error">{error}</p>}
    <p role="status">{busy || notice}</p>
    <label>Client account<select value={accountId} disabled={!!busy || !accounts.length}
      onChange={(event) => { setAccountId(event.target.value); setResults([]); setDraft(null); setNotice(''); setError(''); }}>
      {!accounts.length && <option value="">No accounts available</option>}
      {accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    {!accounts.length && <button type="button" onClick={() => setAccountRevision((value) => value + 1)}>Retry accounts</button>}
    <div className="ingest-columns">
      <section aria-labelledby="import-heading"><h2 id="import-heading">Paste or upload</h2>
        <form onSubmit={submit}><fieldset disabled={!!busy || !accountId}>
          <label>Source type<select value={sourceType} onChange={(event) => {
            setSourceType(event.target.value as IngestSourceType); setFile(null);
          }}><option value="email">Email thread</option><option value="chat">Chat conversation</option><option value="document">Document</option></select></label>
          <label>Title<input required maxLength={300} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Payroll pilot follow-up" /></label>
          <label>Conversation text<textarea required={!file} disabled={!!file} rows={9} value={text}
            onChange={(event) => setText(event.target.value)} aria-describedby="paste-help" /></label>
          <p id="paste-help">Keep From, To and Date headers in email threads. For chats, use [timestamp] Author: message. {text.length.toLocaleString()} / 100,000 characters.</p>
          {text.length > MAX_TEXT && <p role="alert">This paste is too large. Split it into smaller imports.</p>}
          {sourceType === 'document' && <label>Or upload a document (5 MB maximum)
            <input type="file" accept=".txt,.md,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <small>UTF-8 TXT/Markdown or text-based PDF, up to 50 pages. Scanned PDFs are not supported.</small>
          </label>}
          {file && <button type="button" onClick={() => setFile(null)}>Use pasted text instead</button>}
          <button type="submit" disabled={text.length > MAX_TEXT || !title.trim()}>Add to grove</button>{' '}
          <button type="button" onClick={() => { setSourceType('email'); setFile(null); setTitle('Payroll pilot follow-up'); setText(demoEmail); }}>Load sample email</button>
        </fieldset></form>
      </section>
      <section aria-labelledby="slack-heading"><h2 id="slack-heading">Connect Slack channel</h2>
        <p>Link a public channel to this account, then manually sync new messages. Invite your workspace bot to the channel first.</p>
        <form onSubmit={(event) => { event.preventDefault(); void run('Syncing Slack…', async () => {
          const result = await api.syncSlack({ accountId, channelId: channelId.trim() });
          addResults(result.sources.map((source) => ({ source, seeds: result.seeds.filter((seed) => seed.sourceId === source.id), roots: [] })));
          setNotice(result.importedMessages ? result.importedMessages + ' Slack messages imported.' : 'No new Slack messages.');
        }); }}><fieldset disabled={!!busy || !accountId}>
          <label>Channel ID<input required pattern="C[A-Z0-9]{5,30}" value={channelId}
            onChange={(event) => setChannelId(event.target.value)} placeholder="C012ABCDEF" /></label>
          <button type="submit">Connect and sync</button>
        </fieldset></form>
        <p>One channel links to one account. Only channel messages are synced; thread replies and edits are not included.</p>
        <h2>Draft follow-up</h2><p>Draft from stored commitments and decisions, then review and edit.</p>
        <button type="button" disabled={!!busy || !accountId} onClick={() => void run('Drafting…', async () => setDraft(await api.draftFollowup(accountId)))}>Draft follow-up</button>
        {draft && <div>
          <label>Subject<input value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} /></label>
          <label>Email draft<textarea rows={10} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>
          <button type="button" onClick={() => void run('Copying…', async () => {
            await navigator.clipboard.writeText('Subject: ' + draft.subject + '\n\n' + draft.body); setNotice('Draft copied.');
          })}>Copy draft</button><p>Nothing is sent automatically.</p>
        </div>}
      </section>
    </div>
    <section aria-labelledby="results-heading"><h2 id="results-heading">Imported sources</h2>
      {!results.length && <p>Your imports and cited seeds will appear here.</p>}
      {results.map(({ source, seeds }) => <article key={source.id}>
        <h3>{source.title} <small>· {source.type}</small></h3>
        {onOpenGrove && <button type="button" onClick={() => onOpenGrove(source.meetingId, account?.name ?? 'Account grove')}>Open account grove</button>}
        <details><summary>Read source</summary><pre>{source.text}</pre></details>
        {!seeds.length && <p>No commitments, decisions, risks or customer needs found.</p>}
        <ul>{seeds.map((seed) => <li key={seed.id}><strong>{seed.kind.replace('_', ' ')}:</strong> {seed.text}
          <p>{seed.owner ?? 'Unassigned'} · {seed.deadline ?? 'No deadline'}</p>
          {seed.quote && <blockquote>{seed.quote}<cite> — {source.title}</cite></blockquote>}
        </li>)}</ul>
      </article>)}
    </section>
  </main>;
}
