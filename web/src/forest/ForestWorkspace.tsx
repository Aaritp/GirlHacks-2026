import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownUp, Building2, Check, CircleHelp, Flag, Leaf, List, Map, Plus, RefreshCw, Search, Sprout, Trees, X } from 'lucide-react';
import type { GroveApi } from '../api/contracts';
import { inputBus } from '../input/inputBus';
import type { Seed, SeedPatch } from '../types';
import { ForestPlot } from './ForestPlot';
import { PlantForm } from './PlantForm';
import { SeedInspector } from './SeedInspector';
import { growthLabels, growthState, type GrowthState } from './health';
import { useGrove } from './useGrove';
import '@fontsource-variable/manrope';
import '@fontsource/forum/latin-400.css';
import './forest.css';

type Filter = 'all' | GrowthState;

export function ForestWorkspace({ api, meetingId, meetingTitle, demo = false, refreshSignal = 0, children }: {
  api: GroveApi; meetingId: string; meetingTitle: string; demo?: boolean;
  /** Change this value to reload the grove after another feature saves seeds. */
  refreshSignal?: number;
  /** Other owners' panels, shown below the grove. */
  children?: ReactNode;
}) {
  const { grove, loading, busy, error, notice, refresh, updateSeed, createSeed } = useGrove(api, meetingId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [planting, setPlanting] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [list, setList] = useState(false);
  const [showRoots, setShowRoots] = useState(true);
  const [sortByDeadline, setSortByDeadline] = useState(false);
  const [help, setHelp] = useState(false);
  const [dwell, setDwell] = useState<{ x: number; y: number; progress: number } | null>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const now = Date.now();
  const selected = grove.seeds.find((seed) => seed.id === selectedId) ?? null;
  const select = (id: string) => {
    setSelectedId(id); setPlanting(false);
    if (window.matchMedia?.('(max-width:1100px)').matches) {
      requestAnimationFrame(() => {
        const panel = workspace.current?.querySelector<HTMLElement>('.inspector');
        panel?.scrollIntoView({ behavior: 'auto', block: 'start' });
        panel?.focus({ preventScroll: true });
      });
    }
  };
  const dismiss = () => { setSelectedId(null); setPlanting(false); };
  const plant = () => { setPlanting(true); setSelectedId(null); };
  const updateSelected = (patch: SeedPatch, message?: string) => selected
    ? updateSeed(selected.id, patch, message) : Promise.resolve(null);

  useEffect(() => { initialized.current = false; setSelectedId(null); setPlanting(false); }, [meetingId]);
  useEffect(() => { if (refreshSignal) void refresh(true); }, [refreshSignal, refresh]);
  useEffect(() => {
    if (!loading && !initialized.current && grove.seeds.length) {
      initialized.current = true;
      setSelectedId(grove.seeds[0].id);
    }
  }, [loading, grove.seeds]);

  // Stable subscriptions see current state without re-subscribing every pointer frame.
  const actions = useRef({ selected, busy, select, dismiss, plant, updateSelected });
  actions.current = { selected, busy, select, dismiss, plant, updateSelected };
  useEffect(() => {
    const targetAt = (x: number, y: number) => document.elementFromPoint(x * window.innerWidth, y * window.innerHeight);
    const unsubscribe = [
      inputBus.on('select', (event) => {
        const target = targetAt(event.x, event.y);
        if (!target || !workspace.current?.contains(target)) return;
        const seed = target.closest<HTMLElement>('[data-seed-id]');
        if (seed?.dataset.seedId) actions.current.select(seed.dataset.seedId);
        else if (event.source !== 'mouse') {
          const control = target.closest<HTMLElement>('button, input, textarea, select');
          if (control instanceof HTMLButtonElement && !control.disabled) control.click();
          else control?.focus();
        }
        setDwell(null);
      }),
      inputBus.on('plant', (event) => {
        const target = targetAt(event.x, event.y);
        if (target && workspace.current?.contains(target) && !actions.current.busy) actions.current.plant();
      }),
      inputBus.on('resize', (event) => {
        const { selected: seed, busy: saving, updateSelected: update } = actions.current;
        if (!seed || saving || !Number.isFinite(event.scale) || event.scale <= 0) return;
        const size = Math.round(Math.max(.75, Math.min(1.5, seed.size * event.scale)) * 100) / 100;
        if (size !== seed.size) void update({ size }, 'Plant size saved.');
      }),
      inputBus.on('confirm', () => {
        const { selected: seed, busy: saving, updateSelected: update } = actions.current;
        if (seed && !saving && seed.kind !== 'decision') void update({ kind: 'decision' }, 'Marked as a decision.');
      }),
      inputBus.on('dismiss', () => actions.current.dismiss()),
      inputBus.on('dwell', (event) => {
        const target = targetAt(event.x, event.y);
        setDwell(event.progress > 0 && target && workspace.current?.contains(target) ? event : null);
      }),
    ];
    return () => unsubscribe.forEach((remove) => remove());
  }, []);

  const visible = grove.seeds.filter((seed) =>
    (filter === 'all' || growthState(seed, now) === filter)
    && `${seed.text} ${seed.owner ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  if (sortByDeadline) visible.sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'));
  const counts = (state: Filter) => state === 'all' ? grove.seeds.length : grove.seeds.filter((seed) => growthState(seed, now) === state).length;
  const onPlant = async (seed: Seed) => {
    const saved = await createSeed(seed);
    if (saved) { setFilter('all'); setQuery(''); select(saved.id); }
    return saved;
  };

  return <div className="grove-app" ref={workspace} onKeyDown={(event) => {
    if (event.key === 'Escape') { dismiss(); setHelp(false); }
  }}>
    <a href="#grove-main" className="skip-link">Skip to grove</a>
    <nav className="sidebar" aria-label="Grove navigation">
      <a className="brand" href="#grove-main"><span className="brand-mark"><Trees size={25} strokeWidth={1.65} /></span>grovekeeper<span className="brand-period">.</span></a>
      <div className="workspace-label"><span className="workspace-monogram">G</span><span>Our workspace<small>A place for progress</small></span></div>
      <button className={`nav-item ${!list ? 'active' : ''}`} onClick={() => setList(false)}><Trees size={19} />Meeting grove{!list && <span className="nav-current" />}</button>
      <button className={`nav-item ${list ? 'active' : ''}`} onClick={() => setList(true)}><List size={19} />Seed list{list && <span className="nav-current" />}</button>
      <div className="sidebar-section"><h2>Growth stages</h2>
        {(['all', 'seed', 'sprout', 'bloom', 'wilted'] as Filter[]).map((stage) => <button key={stage}
          className={`stage-filter ${filter === stage ? 'active' : ''}`} onClick={() => setFilter(stage)} aria-pressed={filter === stage}>
          <span className={`stage-dot ${stage}`} /><span>{stage === 'all' ? 'All seeds' : growthLabels[stage]}</span><span className="stage-count">{counts(stage)}</span>
        </button>)}
      </div>
      <div className="sidebar-bottom"><a className="nav-item" href="?accounts"><Building2 size={18} />Client accounts</a><div className="care-note"><Sprout size={28} strokeWidth={1.25} /><p>Small steps.<br />Lasting growth.</p></div>
        <button className="nav-item" onClick={() => setHelp(!help)} aria-expanded={help}><CircleHelp size={18} />How your grove works</button>
        <span className="workspace-mode"><span />{demo ? 'Demo workspace' : 'Connected workspace'}</span>
      </div>
    </nav>
    <div className="workspace-body">
      <header className="topbar"><div><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>Meeting grove</strong></div>
        <div className="topbar-right"><span className="meeting-label">{meetingTitle}</span><span className="avatar" aria-hidden="true">G</span></div></header>
      <main id="grove-main" tabIndex={-1}>
        <div className="page-heading"><div><h1>Your meeting, taking root.</h1><p>A little care turns shared commitments into real progress.</p></div>
          <button className="button primary plant-action" onClick={plant} disabled={busy || loading}><Plus size={19} />Plant a seed</button></div>
        <div className="meeting-summary"><span className="meeting-chip"><Leaf size={15} />{meetingTitle}</span>
          <span>{grove.seeds.length} seeds</span><span className="summary-divider" /><span>{counts('bloom')} completed</span>
          {demo && <span className="demo-label">Sample meeting · seed changes reset on reload</span>}
        </div>
        {help && <section className="help-panel"><div><h2>A grove that grows with you</h2><p>Select a plant to review its owner, deadline, and source. Record progress to restore health; complete a commitment to see it bloom. Roots show how commitments connect.</p><p>Health declines over seven days without a progress update. Resize changes appearance only. Use your mouse or keyboard to select and tend seeds.</p></div><button className="icon-button" onClick={() => setHelp(false)} aria-label="Close help"><X size={18} /></button></section>}
        <div className="workspace-feedback" aria-live="polite" aria-atomic="true">{busy ? 'Saving your changes…' : notice}</div>
        {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => { void refresh(); }} disabled={busy}>Retry loading</button></div>}
        <div className={`grove-layout ${selected || planting ? 'with-inspector' : ''}`}>
          <section className="grove-panel" aria-label="Grove overview">
            <label className="mobile-stage-filter">Growth stage<select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
              {(['all', 'seed', 'sprout', 'bloom', 'wilted'] as Filter[]).map((stage) => <option key={stage} value={stage}>{stage === 'all' ? 'All seeds' : growthLabels[stage]} ({counts(stage)})</option>)}
            </select></label>
            <div className="grove-toolbar"><div className="view-switch" aria-label="Grove view"><button aria-pressed={!list} onClick={() => setList(false)}><Map size={16} />Garden</button><button aria-pressed={list} onClick={() => setList(true)}><List size={16} />List</button></div>
              <label className="search-box"><Search size={16} /><input aria-label="Search seeds" placeholder="Find a seed…" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
              <button className="icon-button refresh-button" aria-label="Refresh grove" disabled={busy || loading} onClick={() => { void refresh(); }}><RefreshCw size={16} /></button></div>
            <div className="plot-heading"><div><h2>{filter === 'all' ? 'The living grove' : growthLabels[filter]}</h2><span>{visible.length} {visible.length === 1 ? 'seed' : 'seeds'} in view</span></div>
              {list ? <button className="text-button" aria-pressed={sortByDeadline} onClick={() => setSortByDeadline(!sortByDeadline)}><ArrowDownUp size={15} />{sortByDeadline ? 'Deadline order' : 'Sort by deadline'}</button>
                : <label className="root-toggle"><input type="checkbox" checked={showRoots} onChange={(e) => setShowRoots(e.target.checked)} />Show roots</label>}</div>
            {loading ? <div className="grove-loading" role="status"><Sprout size={38} /><p>Opening your grove…</p></div>
              : visible.length === 0 ? <div className="empty-grove"><Sprout size={48} strokeWidth={1.25} /><h3>{grove.seeds.length ? 'No seeds match this view.' : 'A new beginning.'}</h3><p>{grove.seeds.length ? 'Try another name or show all your seeds.' : 'Plant the first commitment from your meeting.'}</p><button className="button secondary" onClick={() => {
                if (grove.seeds.length) { setFilter('all'); setQuery(''); } else plant();
              }}>{grove.seeds.length ? 'Show all seeds' : 'Plant a seed'}</button></div>
                : <ForestPlot key={meetingId} meetingId={meetingId} seeds={visible} allSeeds={grove.seeds} roots={grove.roots}
                  selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setPlanting(false); }} onInspect={select} showRoots={showRoots} list={list} now={now} busy={busy}
                  onProgress={(seed, complete) => { void updateSeed(seed.id, {
                    status: complete ? 'bloom' : 'sprout', health: 1, lastActivity: new Date().toISOString(),
                  }, complete ? 'A promise kept. Your seed is in bloom.' : 'Progress recorded. Keep growing.'); }} />}
            <footer className="garden-footer"><div className="growth-legend">{(['seed', 'sprout', 'bloom', 'wilted'] as GrowthState[]).map((stage) => <span key={stage}><span className={`stage-dot ${stage}`} />{growthLabels[stage]}</span>)}</div><span className="garden-hint">Select a seed to tend to it</span></footer>
          </section>
          {planting ? <PlantForm meetingId={meetingId} busy={busy} onPlant={onPlant} onClose={dismiss} />
            : selected ? <div className="inspector-wrap"><SeedInspector key={selected.id} seed={selected} seeds={grove.seeds} roots={grove.roots} busy={busy} now={now} onUpdate={updateSelected} onSelect={select} onDismiss={dismiss} />
              <button className="decision-button" disabled={busy || selected.kind === 'decision'} onClick={() => inputBus.emit({ type: 'confirm', source: 'mouse' })}>{selected.kind === 'decision' ? <Check size={15} /> : <Flag size={15} />}{selected.kind === 'decision' ? 'Recorded as a decision' : 'Mark as a decision'}</button></div>
              : null}
        </div>
        {children && <div className="workspace-extension">{children}</div>}
        <div className="workspace-footer"><span><Sprout size={16} />Every commitment deserves a place to grow.</span><span>{demo ? 'Explore freely. This is a sample grove.' : 'Changes save to your meeting.'}</span></div>
      </main>
    </div>
    {dwell && <div className="dwell-cursor" style={{ left: `${dwell.x * 100}%`, top: `${dwell.y * 100}%` }} aria-hidden="true"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" pathLength="1" strokeDasharray={`${Math.max(0, Math.min(1, dwell.progress))} 1`} /></svg></div>}
  </div>;
}
