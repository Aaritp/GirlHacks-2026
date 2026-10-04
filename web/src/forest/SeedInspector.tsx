import { useEffect, useState } from 'react';
import { Check, Clock3, Droplets, Link2, Minus, Plus, Sprout, X } from 'lucide-react';
import type { Root, Seed, SeedPatch } from '../types';
import { formatDeadline, growthLabels, growthState, seedHealth, sourceTime } from './health';
import { PlantSymbol } from './PlantSymbol';

// Keyed by string so source types added to the shared contract are labeled, never shown as "Meeting".
const sourceNames: Record<string, string> = {
  meeting: 'Meeting', whiteboard: 'Whiteboard', leaves: 'Whispering Leaves',
  email: 'Email', chat: 'Chat', document: 'Document', slack: 'Slack',
};

interface Props {
  seed: Seed; seeds: Seed[]; roots: Root[]; busy: boolean; now: number;
  onUpdate: (patch: SeedPatch, message?: string) => Promise<Seed | null>;
  onSelect: (id: string) => void; onDismiss: () => void;
}

export function SeedInspector({ seed, seeds, roots, busy, now, onUpdate, onSelect, onDismiss }: Props) {
  const [text, setText] = useState(seed.text);
  const [owner, setOwner] = useState(seed.owner ?? '');
  const [deadline, setDeadline] = useState(seed.deadline ?? '');
  useEffect(() => { setText(seed.text); setOwner(seed.owner ?? ''); setDeadline(seed.deadline ?? ''); }, [seed.id, seed.text, seed.owner, seed.deadline]);
  const state = growthState(seed, now);
  const health = Math.round(seedHealth(seed, now) * 100);
  const connections = roots.filter((root) => root.fromSeedId === seed.id || root.toSeedId === seed.id);
  const dirty = text !== seed.text || owner !== (seed.owner ?? '') || deadline !== (seed.deadline ?? '');
  const advance = () => onUpdate({ status: seed.status === 'bloom' ? 'sprout' : 'bloom',
    health: 1, lastActivity: new Date().toISOString() }, seed.status === 'bloom' ? 'Seed reopened.' : 'A promise kept. Your seed is in bloom.');

  return <aside className="inspector" tabIndex={-1} aria-label="Seed details">
    <div className="panel-heading"><h2>Seed details</h2><button className="icon-button" onClick={onDismiss} aria-label="Close seed details"><X size={18} /></button></div>
    <div className={`inspector-plant ${state}`}><PlantSymbol state={state} /><span className={`status-label ${state}`}>{growthLabels[state]}</span></div>
    <h3>{seed.text}</h3>
    <div className="health-section">
      <div><span>Seed health</span><strong>{health}%</strong></div>
      <meter min="0" max="100" value={health} aria-label="Seed health" />
      <p>{state === 'bloom' ? 'Completed. This seed stays in bloom.' : state === 'wilted'
        ? 'A little attention will help this seed recover.' : 'Check in when you make progress to keep it growing.'}</p>
    </div>
    <div className="seed-facts"><span><small>Owner</small>{seed.owner || 'Unassigned'}</span><span><small>Deadline</small>{formatDeadline(seed.deadline)}</span></div>
    <details className="edit-disclosure"><summary>Edit commitment</summary><form className="seed-edit" onSubmit={(event) => {
      event.preventDefault();
      if (text.trim()) void onUpdate({ text: text.trim(), owner: owner.trim() || null, deadline: deadline || null }, 'Seed details saved.');
    }}>
      <label>Commitment<textarea value={text} onChange={(event) => setText(event.target.value)} required maxLength={500} rows={2} disabled={busy} /></label>
      <div className="field-pair"><label>Owner<input value={owner} placeholder="Unassigned" maxLength={120} onChange={(event) => setOwner(event.target.value)} disabled={busy} /></label>
        <label>Deadline<input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} disabled={busy} /></label></div>
      {dirty && <button className="button secondary full-width" disabled={busy || !text.trim()} type="submit">{busy ? 'Saving…' : 'Save details'}</button>}
    </form></details>
    <div className="progress-actions">
      <button className="button primary full-width" onClick={() => { void advance(); }} disabled={busy}>
        {seed.status === 'bloom' ? <Sprout size={17} /> : <Check size={17} />}{seed.status === 'bloom' ? 'Reopen seed' : 'Mark complete'}</button>
      {seed.status !== 'bloom' && <button className="button secondary full-width" disabled={busy} onClick={() => {
        void onUpdate({ status: 'sprout', health: 1, lastActivity: new Date().toISOString() }, 'Progress recorded. Keep growing.');
      }}><Droplets size={17} />Record progress</button>}
    </div>
    <div className="note-size"><span>Plant size</span><div>
      <button className="icon-button" aria-label="Make plant smaller" disabled={busy || seed.size <= .75} onClick={() => { void onUpdate({ size: Math.max(.75, seed.size - .25) }, 'Plant size saved.'); }}><Minus size={16} /></button>
      <span>{Math.round(seed.size * 100)}%</span>
      <button className="icon-button" aria-label="Make plant larger" disabled={busy || seed.size >= 1.5} onClick={() => { void onUpdate({ size: Math.min(1.5, seed.size + .25) }, 'Plant size saved.'); }}><Plus size={16} /></button>
    </div></div>
    <section className="source-section"><h4><Clock3 size={15} />Where it started</h4>
      <p>{sourceNames[seed.sourceType] ?? 'Other source'} · {sourceTime(seed.timestampSec)}</p>
      <span className="source-id">Source: {seed.sourceId}</span>
    </section>
    {connections.length > 0 && <section className="connection-section"><h4><Link2 size={15} />Connected roots</h4>
      {connections.map((root) => {
        const outgoing = root.fromSeedId === seed.id;
        const other = seeds.find((item) => item.id === (outgoing ? root.toSeedId : root.fromSeedId));
        return other && <button key={root.id} onClick={() => onSelect(other.id)} className="connection-link">
          <span>{root.type === 'related' ? 'Related to' : outgoing ? 'Depends on' : 'Needed by'}</span>{other.text}
        </button>;
      })}
    </section>}
  </aside>;
}
