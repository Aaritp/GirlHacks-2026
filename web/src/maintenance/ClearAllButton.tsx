import { useState } from 'react';
import type { GroveApi } from '../api/contracts';

const PHRASE = 'CLEAR ALL';

interface Props {
  api: Pick<GroveApi, 'clearAll'>;
  /** Browser sample data only (mock mode): say so, since nothing real is touched. */
  mockMode?: boolean;
  /** After a successful clear. Defaults to reloading the page so every panel starts fresh. */
  onCleared?: () => void;
}

/**
 * Development reset: removes test transcripts, seeds and sources. Requires typing the phrase,
 * and the server must opt in with GROVEKEEPER_ALLOW_CLEAR_ALL=true.
 */
export function ClearAllButton({ api, mockMode = false, onCleared = () => window.location.reload() }: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [keepAccounts, setKeepAccounts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: 'status' | 'alert' } | null>(null);

  function close() {
    setOpen(false);
    setTyped('');
    setKeepAccounts(true);
    setMessage(null);
  }

  async function clear() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.clearAll({ confirm: typed, keepAccounts });
      const total = Object.values(result.deleted).reduce((sum, count) => sum + count, 0);
      setMessage({ text: `Cleared ${total} record(s). Reloading…`, kind: 'status' });
      onCleared();
    } catch (reason) {
      setMessage({ text: reason instanceof Error ? reason.message : 'Could not clear data.', kind: 'alert' });
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <button type="button" onClick={() => setOpen(true)}>Clear all data…</button>;
  return (
    <section aria-labelledby="clear-all-heading" style={{ padding: 12, border: '1px solid #c0392b', borderRadius: 8 }}>
      <h2 id="clear-all-heading" style={{ fontSize: 18, margin: 0 }}>Clear all data</h2>
      <p>
        Permanently deletes every transcript, seed, source and Slack sync record
        {mockMode ? ' in this browser\'s sample data' : ' in the connected storage, for everyone who uses it'}.
        This cannot be undone.
      </p>
      <label><input type="checkbox" checked={!keepAccounts} onChange={(event) => setKeepAccounts(!event.target.checked)} />
        {' '}Also remove client accounts</label>
      <p>
        <label>Type {PHRASE} to confirm{' '}
          <input value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" disabled={busy} />
        </label>
      </p>
      <button type="button" onClick={clear} disabled={busy || typed !== PHRASE}>{busy ? 'Clearing…' : 'Clear everything'}</button>{' '}
      <button type="button" onClick={close} disabled={busy}>Cancel</button>
      {message && <p role={message.kind}>{message.text}</p>}
    </section>
  );
}
