import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft, Check, FileText, Leaf, List, Mail, Map as MapIcon, MessageCircle, MessagesSquare, PenLine,
  Presentation, RefreshCw, Sprout, Video, X, type LucideIcon,
} from 'lucide-react';
import { PlantSymbol } from '../forest/PlantSymbol';
import { formatDeadline } from '../forest/health';
import type { AccountsApi } from './api';
import {
  UNASSIGNED, accountSeeds, displayState, filterSeeds, formatDay, kindLabels, newestFirst, noFilter,
  plantFor, sourceLabels, stateLabels, stateReason, summarize, today, type SeedFilter,
} from './state';
import type { Account, AccountSeed, AccountSource, SeedKind, SourceType } from './types';
import { useAccountTimeline } from './useAccountTimeline';

const sourceIcons: Record<SourceType | 'leaves', LucideIcon> = {
  meeting: Video, whiteboard: Presentation, email: Mail, chat: MessageCircle,
  document: FileText, slack: MessagesSquare, leaves: PenLine,
};
export function SourceIcon({ type, size = 18 }: { type: SourceType | 'leaves'; size?: number }) {
  const Icon = sourceIcons[type] ?? FileText;
  return <span className={`source-icon ${type}`} data-source-type={type} role="img" aria-label={sourceLabels[type] ?? 'Source'}><Icon size={size} /></span>;
}

interface Props {
  api: AccountsApi; accountId: string; account?: Account; demo?: boolean;
  onBack: () => void;
  /** Person D's Ask the Grove component, scoped to this account. */
  renderAsk?: (accountId: string) => ReactNode;
  refreshSignal?: number;
}

export function AccountDashboard({ api, accountId, account, demo = false, onBack, renderAsk, refreshSignal }: Props) {
  const { timeline, loading, busy, error, saveError, notice, refresh, setStatus } = useAccountTimeline(api, accountId, refreshSignal);
  const [filter, setFilter] = useState<SeedFilter>(noFilter);
  const [list, setList] = useState(false);
  const [seedId, setSeedId] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const date = today();

  const items = useMemo(() => timeline ? newestFirst(timeline) : [], [timeline]);
  const seeds = useMemo(() => timeline ? accountSeeds(timeline) : [], [timeline]);
  const sources = useMemo(() => new Map(items.map((item) => [item.source.id, item.source])), [items]);
  const owners = useMemo(() => [...new Set(seeds.map((seed) => seed.owner).filter((owner): owner is string => !!owner))].sort(), [seeds]);
  const visible = filterSeeds(seeds, filter);
  const selected = seeds.find((seed) => seed.id === seedId) ?? null;
  const opened = items.find((item) => item.source.id === sourceId) ?? null;
  const summary = timeline ? summarize(timeline) : null;
  useEffect(() => { setSeedId(null); setSourceId(null); setFilter(noFilter); }, [accountId]);

  const showSource = (id: string) => {
    setSourceId(id);
    requestAnimationFrame(() => document.getElementById('source-detail')?.focus());
  };
  const title = account?.name ?? (loading ? 'Loading account…' : 'Client account');

  return <div className="account-dashboard" onKeyDown={(event) => { if (event.key === 'Escape') { setSeedId(null); setSourceId(null); } }}>
    <button className="text-button back-link" onClick={onBack}><ArrowLeft size={16} />All accounts</button>
    <div className="page-heading"><div><h1>{title}</h1>
      {account && <p>{account.industry}{account.aliases.length > 0 && ` · also known as ${account.aliases.join(', ')}`}</p>}</div>
      <button className="button secondary" onClick={() => { void refresh(); }} disabled={busy || loading}><RefreshCw size={17} />Refresh</button></div>
    <div className="meeting-summary">
      {summary && <><span className="meeting-chip"><Leaf size={15} />{summary.openCommitments} open {summary.openCommitments === 1 ? 'commitment' : 'commitments'}</span>
        <span className="summary-divider" /><span>{summary.risks} {summary.risks === 1 ? 'risk' : 'risks'}</span>
        <span className="summary-divider" /><span>{items.length} {items.length === 1 ? 'source' : 'sources'}</span></>}
      {demo && <span className="demo-label">Sample account · changes reset on reload</span>}
    </div>
    <div className="workspace-feedback" aria-live="polite" aria-atomic="true">{busy ? 'Saving your change…' : notice}</div>
    {saveError && <div className="error-banner" role="alert"><span>{saveError}</span></div>}
    {error && <div className="error-banner" role="alert"><span>{error}{timeline ? ' Showing the last loaded data.' : ''}</span>
      <button onClick={() => { void refresh(); }} disabled={busy}>Retry loading</button></div>}

    <section className="ask-slot" aria-label="Ask the Grove" data-account-id={accountId}>
      {renderAsk ? renderAsk(accountId)
        : <p><strong>Ask the Grove</strong> will appear here, answering questions about {account?.name ?? 'this account'} only. It is not connected yet.</p>}
    </section>

    {loading && !timeline ? <div className="grove-loading" role="status"><Sprout size={38} /><p>Opening this account…</p></div>
      : !timeline ? null : <>
        <section className="account-section" aria-labelledby="account-grove-heading">
          <div className="section-heading"><h2 id="account-grove-heading">Account grove</h2>
            <span>{visible.length} of {seeds.length} {seeds.length === 1 ? 'seed' : 'seeds'}</span></div>
          <div className="account-toolbar">
            <div className="view-switch" aria-label="Grove view"><button aria-pressed={!list} onClick={() => setList(false)}><MapIcon size={16} />Forest</button>
              <button aria-pressed={list} onClick={() => setList(true)}><List size={16} />List</button></div>
            <label>Kind<select value={filter.kind} onChange={(event) => setFilter({ ...filter, kind: event.target.value as SeedKind | 'all' })}>
              <option value="all">All kinds</option>
              {(Object.keys(kindLabels) as SeedKind[]).map((kind) => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}</select></label>
            <label>Owner<select value={filter.owner} onChange={(event) => setFilter({ ...filter, owner: event.target.value })}>
              <option value="all">All owners</option>
              {owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
              <option value={UNASSIGNED}>Unassigned</option></select></label>
          </div>
          <div className={`account-split ${selected ? 'with-detail' : ''}`}>
            {seeds.length === 0 ? <div className="empty-grove"><Sprout size={48} strokeWidth={1.25} /><h3>Nothing planted yet.</h3>
              <p>No commitments, decisions, risks, or needs have been found for this account.</p></div>
              : visible.length === 0 ? <div className="empty-grove"><h3>No seeds match these filters.</h3>
                <button className="button secondary" onClick={() => setFilter(noFilter)}>Clear filters</button></div>
                : list ? <table className="account-table"><thead><tr><th scope="col">Seed</th><th scope="col">Kind</th><th scope="col">Owner</th><th scope="col">Deadline</th><th scope="col">State</th><th scope="col">Source</th></tr></thead>
                  <tbody>{visible.map((seed) => {
                    const state = displayState(seed, date);
                    return <tr key={seed.id} className={seed.id === seedId ? 'selected' : ''} data-seed-id={seed.id} data-state={state}>
                      <th scope="row"><button className="row-link" aria-pressed={seed.id === seedId} onClick={() => setSeedId(seed.id)}>{seed.text}</button></th>
                      <td>{kindLabels[seed.kind]}</td><td>{seed.owner ?? 'Unassigned'}</td><td>{formatDeadline(seed.deadline)}</td>
                      <td><span className={`state-tag ${state}`}>{stateLabels[state]}</span></td>
                      <td>{sources.get(seed.sourceId)?.title ?? sourceLabels[seed.sourceType]}</td></tr>;
                  })}</tbody></table>
                  : <ul className="account-forest" aria-label="Account forest">{visible.map((seed) => {
                    const state = displayState(seed, date);
                    return <li key={seed.id}><button className={`forest-plant ${seed.id === seedId ? 'selected' : ''}`} data-seed-id={seed.id} data-state={state}
                      aria-pressed={seed.id === seedId} onClick={() => setSeedId(seed.id)}>
                      <PlantSymbol state={plantFor[state]} />
                      <span className="plant-title">{seed.text}</span>
                      <span className="plant-meta">{kindLabels[seed.kind]}<span className="meta-dot" /><span className={`state-tag ${state}`}>{stateLabels[state]}</span></span>
                    </button></li>;
                  })}</ul>}
            {selected && <SeedDetail seed={selected} source={sources.get(selected.sourceId)} busy={busy} date={date}
              onClose={() => setSeedId(null)} onShowSource={showSource} onStatus={(status) => { void setStatus(selected, status); }} />}
          </div>
        </section>

        <section className="account-section" aria-labelledby="timeline-heading">
          <div className="section-heading"><h2 id="timeline-heading">Timeline</h2><span>Newest first</span></div>
          <div className={`account-split ${opened ? 'with-detail' : ''}`}>
            {items.length === 0 ? <div className="empty-grove"><h3>No conversations yet.</h3>
              <p>Meetings, emails, chats, documents, and Slack threads for this account will appear here.</p></div>
              : <ol className="timeline">{items.map(({ source, seeds: found }) => <li key={source.id}>
                <button className={`timeline-item ${source.id === sourceId ? 'selected' : ''}`} data-source-id={source.id}
                  aria-pressed={source.id === sourceId} onClick={() => showSource(source.id)}>
                  <SourceIcon type={source.type} />
                  <span className="timeline-body"><span className="timeline-title">{source.title}</span>
                    <span className="timeline-meta">{sourceLabels[source.type]} · <time dateTime={source.createdAt}>{formatDay(source.createdAt)}</time> · {found.length} {found.length === 1 ? 'seed' : 'seeds'}</span></span>
                </button></li>)}</ol>}
            {opened && <SourceDetail source={opened.source} seeds={opened.seeds.filter((seed) => seed.accountId === accountId)} date={date}
              onClose={() => setSourceId(null)} onSeed={(id) => { setFilter(noFilter); setSeedId(id); }} />}
          </div>
        </section>
      </>}
  </div>;
}

function SeedDetail({ seed, source, busy, date, onClose, onShowSource, onStatus }: {
  seed: AccountSeed; source?: AccountSource; busy: boolean; date: string;
  onClose: () => void; onShowSource: (id: string) => void; onStatus: (status: 'sprout' | 'bloom') => void;
}) {
  const state = displayState(seed, date);
  const done = seed.status === 'bloom';
  return <aside className="account-detail" aria-label="Seed details">
    <div className="panel-heading"><h3>Seed details</h3><button className="icon-button" onClick={onClose} aria-label="Close seed details"><X size={18} /></button></div>
    <p className="detail-kicker">{kindLabels[seed.kind]} · <span className={`state-tag ${state}`}>{stateLabels[state]}</span> · {stateReason(seed, date)}</p>
    <h4>{seed.text}</h4>
    <dl className="detail-facts"><div><dt>Owner</dt><dd>{seed.owner ?? 'Unassigned'}</dd></div><div><dt>Deadline</dt><dd>{formatDeadline(seed.deadline)}</dd></div></dl>
    <h5>Where it came from</h5>
    {seed.quote ? <blockquote>{seed.quote}</blockquote> : <p className="detail-muted">No quote was recorded for this seed.</p>}
    <p className="detail-source"><SourceIcon type={seed.sourceType} size={16} />{source ? `${source.title} · ${formatDay(source.createdAt)}` : `${sourceLabels[seed.sourceType]} · source ${seed.sourceId}`}</p>
    {source && <button className="text-button" onClick={() => onShowSource(source.id)}>Read the full source</button>}
    <button className={`button full-width ${done ? 'secondary' : 'primary'}`} disabled={busy} onClick={() => onStatus(done ? 'sprout' : 'bloom')}>
      {done ? <Sprout size={17} /> : <Check size={17} />}{done ? 'Reopen' : 'Mark done'}</button>
  </aside>;
}

function SourceDetail({ source, seeds, date, onClose, onSeed }: {
  source: AccountSource; seeds: AccountSeed[]; date: string; onClose: () => void; onSeed: (id: string) => void;
}) {
  return <aside className="account-detail" id="source-detail" tabIndex={-1} aria-label="Source details">
    <div className="panel-heading"><h3>{source.title}</h3><button className="icon-button" onClick={onClose} aria-label="Close source details"><X size={18} /></button></div>
    <p className="detail-source"><SourceIcon type={source.type} size={16} />{sourceLabels[source.type]} · {formatDay(source.createdAt)}</p>
    {source.text ? <p className="source-text">{source.text}</p>
      : <p className="detail-muted">{source.type === 'meeting' ? 'The transcript of this meeting is not shown here yet. Each seed below quotes the words it came from.' : 'The text of this source is not available.'}</p>}
    <h5>Seeds from this source</h5>
    {seeds.length === 0 ? <p className="detail-muted">Nothing was extracted from this source.</p>
      : <ul className="source-seeds">{seeds.map((seed) => {
        const state = displayState(seed, date);
        return <li key={seed.id}><button className="row-link" onClick={() => onSeed(seed.id)}>{seed.text}</button>
          {seed.quote && <blockquote>{seed.quote}</blockquote>}
          <span className="detail-muted">{kindLabels[seed.kind]} · <span className={`state-tag ${state}`}>{stateLabels[state]}</span></span></li>;
      })}</ul>}
  </aside>;
}
