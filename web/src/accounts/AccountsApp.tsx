import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Building2, ChevronRight, Sprout, Trees } from 'lucide-react';
import '@fontsource-variable/manrope';
import '../forest/forest.css';
import './accounts.css';
import type { Account } from '../types';
import { AccountDashboard } from './AccountDashboard';
import type { AccountsApi } from './api';
import { summarize, type AccountSummary } from './state';

const selectedAccount = () => new URLSearchParams(window.location.search).get('account');

export function AccountsApp({ api, demo = false, renderAsk, refreshSignal }: {
  api: AccountsApi; demo?: boolean;
  /** Person D's Ask the Grove component, scoped to the open account. */
  renderAsk?: (accountId: string) => ReactNode;
  /** Change this value to reload the open account after another feature saves seeds. */
  refreshSignal?: number;
}) {
  const [accountId, setAccountId] = useState(selectedAccount);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  // null means the counts for that account could not be loaded; it is never shown as zero.
  const [summaries, setSummaries] = useState<Record<string, AccountSummary | null>>({});
  const [error, setError] = useState('');
  const version = useRef(0);

  const load = useCallback(async () => {
    const revision = ++version.current;
    setError('');
    try {
      const list = await api.listAccounts();
      if (version.current !== revision) return;
      setAccounts(list);
      const results = await Promise.allSettled(list.map((account) => api.getTimeline(account.id)));
      if (version.current !== revision) return;
      setSummaries(Object.fromEntries(list.map((account, index) => {
        const result = results[index];
        return [account.id, result.status === 'fulfilled' ? summarize(result.value) : null];
      })));
    } catch (reason) {
      if (version.current === revision) setError(`Could not load accounts. ${reason instanceof Error ? reason.message : 'Please try again.'}`);
    }
  }, [api]);

  // Loads on mount and again on returning to the list, so counts reflect changes made inside an account.
  const loaded = useRef(false);
  useEffect(() => {
    if (accountId && loaded.current) return;
    loaded.current = true;
    void load();
  }, [load, accountId]);
  useEffect(() => {
    const onPop = () => setAccountId(selectedAccount());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const open = (id: string | null) => {
    window.history.pushState(null, '', id ? `?account=${encodeURIComponent(id)}` : '?accounts');
    setAccountId(id);
    document.getElementById('grove-main')?.focus();
  };
  const current = accounts?.find((account) => account.id === accountId);

  return <div className="grove-app">
    <a href="#grove-main" className="skip-link">Skip to content</a>
    <nav className="sidebar" aria-label="Grove navigation">
      <a className="brand" href="?accounts" onClick={(event) => { event.preventDefault(); open(null); }}><span className="brand-mark"><Trees size={25} strokeWidth={1.65} /></span>grovekeeper<span className="brand-period">.</span></a>
      <button className={`nav-item ${!accountId ? 'active' : ''}`} onClick={() => open(null)}><Building2 size={19} />Client accounts{!accountId && <span className="nav-current" />}</button>
      {accounts && accounts.length > 0 && <div className="sidebar-section"><h2>Accounts</h2>
        {accounts.map((account) => <button key={account.id} className={`stage-filter ${account.id === accountId ? 'active' : ''}`}
          aria-current={account.id === accountId ? 'page' : undefined} onClick={() => open(account.id)}>
          <span className="stage-dot all" /><span>{account.name}</span></button>)}
      </div>}
      <div className="sidebar-bottom"><a className="nav-item" href="./"><Trees size={18} />Meeting grove</a>
        <span className="workspace-mode"><span />{demo ? 'Demo workspace' : 'Connected workspace'}</span></div>
    </nav>
    <div className="workspace-body">
      <header className="topbar"><div><span>Client accounts</span>{accountId && <><span className="breadcrumb-slash">/</span><strong>{current?.name ?? 'Account'}</strong></>}</div></header>
      <main id="grove-main" tabIndex={-1}>
        {accountId
          ? <AccountDashboard key={accountId} api={api} accountId={accountId} account={current} demo={demo}
            onBack={() => open(null)} renderAsk={renderAsk} refreshSignal={refreshSignal} />
          : <>
            <div className="page-heading"><div><h1>Every client, one grove.</h1><p>Open an account to see what was said, what was promised, and what is at risk.</p></div></div>
            {demo && <div className="meeting-summary"><span className="demo-label">Sample accounts · changes reset on reload</span></div>}
            {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => { void load(); }}>Retry loading</button></div>}
            {accounts === null ? (!error && <div className="grove-loading" role="status"><Sprout size={38} /><p>Loading accounts…</p></div>)
              : accounts.length === 0 ? <div className="empty-grove"><Sprout size={48} strokeWidth={1.25} /><h3>No client accounts yet.</h3><p>Accounts appear here once they are created.</p></div>
                : <ul className="account-list" aria-label="Client accounts">{accounts.map((account) => {
                  const summary = summaries[account.id];
                  return <li key={account.id}><button className="account-card" data-account-id={account.id} onClick={() => open(account.id)}>
                    <span className="account-name">{account.name}</span>
                    <span className="account-industry">{account.industry}</span>
                    {summary === undefined ? <span className="account-counts">Counting…</span>
                      : summary === null ? <span className="account-counts unavailable">Counts unavailable</span>
                        : <span className="account-counts"><span><strong>{summary.openCommitments}</strong> open {summary.openCommitments === 1 ? 'commitment' : 'commitments'}</span>
                          <span className={summary.risks ? 'has-risk' : ''}><strong>{summary.risks}</strong> {summary.risks === 1 ? 'risk' : 'risks'}</span></span>}
                    <ChevronRight size={20} className="account-chevron" aria-hidden="true" />
                  </button></li>;
                })}</ul>}
          </>}
      </main>
    </div>
  </div>;
}
