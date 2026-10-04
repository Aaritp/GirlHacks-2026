import { useEffect, useRef, useState } from 'react';
import { scalePoint } from 'd3-scale';
import { linkVertical } from 'd3-shape';
import { Check, Droplets, Move, RotateCcw, ArrowUpRight } from 'lucide-react';
import type { Root, Seed } from '../types';
import { formatDeadline, growthLabels, growthState } from './health';
import { PlantSymbol } from './PlantSymbol';

type Position = [number, number];
interface Props {
  seeds: Seed[]; allSeeds: Seed[]; meetingId: string; roots: Root[];
  selectedId: string | null; onSelect: (id: string) => void;
  onInspect: (id: string) => void;
  onProgress: (seed: Seed, complete: boolean) => void; busy: boolean;
  showRoots: boolean; list: boolean; now: number;
}
const constrain = ([x, y]: Position): Position => [Math.max(15, Math.min(85, x)), Math.max(22, Math.min(80, y))];
function readLayout(key: string): Record<string, Position> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, point]) => Array.isArray(point)
      && point.length === 2 && point.every((n: unknown) => typeof n === 'number' && Number.isFinite(n)))
      .map(([id, point]) => [id, constrain(point as Position)]));
  } catch { return {}; }
}

export function ForestPlot({ seeds, allSeeds, meetingId, roots, selectedId, onSelect, onInspect, onProgress, busy, showRoots, list, now }: Props) {
  const storageKey = `grovekeeper:layout:${meetingId}`;
  const [custom, setCustom] = useState(() => readLayout(storageKey));
  const [arranging, setArranging] = useState(false);
  const [layoutNotice, setLayoutNotice] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const garden = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x: number; y: number; start: Position; current: Position; moved: boolean } | null>(null);
  const skipClick = useRef(false);
  useEffect(() => {
    const compact = window.matchMedia?.('(max-width:700px)');
    const exitArrangement = () => {
      if (compact?.matches) { setArranging(false); drag.current = null; setDragging(null); }
    };
    compact?.addEventListener('change', exitArrangement);
    return () => compact?.removeEventListener('change', exitArrangement);
  }, []);
  const rows = Math.max(2, Math.ceil(allSeeds.length / 3));
  const x = scalePoint<number>().domain([0, 1, 2]).range([18, 82]);
  const y = scalePoint<number>().domain(Array.from({ length: rows }, (_, i) => i)).range([26, 74]);
  const positions = new Map(allSeeds.map((seed, i) => [seed.id, custom[seed.id]
    ?? [x(i % 3)!, y(Math.floor(i / 3))! + (i % 3 === 1 ? 3 : -1)] as Position]));
  const path = linkVertical<{ source: Position; target: Position }, Position>().x(d => d[0]).y(d => d[1]);
  const saveLayout = (next: Record<string, Position>) => {
    setCustom(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setLayoutNotice('Arrangement saved on this device.'); }
    catch { setLayoutNotice('Arrangement changed for this visit. Device storage is unavailable.'); }
  };

  if (list) return <div className="seed-list" aria-label="Seed list">
    <div className="list-head"><span>Commitment</span><span>Owner</span><span>Deadline</span><span>Growth</span></div>
    {seeds.map((seed) => {
      const state = growthState(seed, now);
      return <button key={seed.id} className={`seed-row ${selectedId === seed.id ? 'selected' : ''}`}
        data-seed-id={seed.id} onClick={() => onInspect(seed.id)} aria-pressed={selectedId === seed.id}>
        <span className="row-title"><PlantSymbol state={state} /><span>{seed.text}</span></span>
        <span>{seed.owner || 'Unassigned'}</span><span>{formatDeadline(seed.deadline)}</span>
        <span className={`status-label ${state}`}>{growthLabels[state]}</span>
      </button>;
    })}
  </div>;

  return <>
    <div className="arrange-toolbar">
      <span id="arrange-help">{arranging ? 'Drag a plant, or focus it and use Alt + arrow keys.' : 'Select a plant. Give your next step room to grow.'}</span>
      <button className="text-button" aria-pressed={arranging} onClick={() => setArranging(!arranging)}><Move size={14} />{arranging ? 'Done arranging' : 'Arrange'}</button>
      {arranging && <button className="icon-button" aria-label="Reset plant arrangement" onClick={() => saveLayout({})}><RotateCcw size={15} /></button>}
    </div>
    <span className="sr-only" role="status">{layoutNotice}</span>
    <div className="garden-scroll">
      <div ref={garden} className={`garden ${arranging ? 'arranging' : ''}`} style={{ minHeight: `${Math.max(610, rows * 305)}px` }} aria-label="Meeting garden">
        <svg className="root-network" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {showRoots && roots.map((root) => {
            const source = positions.get(root.fromSeedId), target = positions.get(root.toSeedId);
            if (!source || !target || !seeds.some(s => s.id === root.fromSeedId) || !seeds.some(s => s.id === root.toSeedId)) return null;
            const active = root.fromSeedId === selectedId || root.toSeedId === selectedId;
            return <path key={root.id} d={path({ source: [source[0], source[1] + 2], target: [target[0], target[1] + 2] }) ?? ''}
              className={`${active ? 'active' : ''} ${root.type === 'related' ? 'related' : ''}`} />;
          })}
        </svg>
        {seeds.map((seed) => {
          const [left, top] = positions.get(seed.id)!;
          const state = growthState(seed, now);
          const selected = selectedId === seed.id;
          return <div key={seed.id} className={`garden-node ${selected ? 'selected' : ''} ${dragging === seed.id ? 'dragging' : ''}`}
            style={{ left: `${left}%`, top: `${top}%`, '--seed-size': Math.max(.75, Math.min(1.5, seed.size)) } as React.CSSProperties}>
            <button type="button" data-seed-id={seed.id} className={`garden-seed ${selected ? 'selected' : ''} ${state}`}
              aria-pressed={selected} aria-describedby={arranging ? 'arrange-help' : undefined}
              aria-label={`${seed.text}, ${growthLabels[state]}, ${seed.owner || 'Unassigned'}`}
              onClick={() => { if (skipClick.current) { skipClick.current = false; return; } if (!arranging) onSelect(seed.id); }}
              onPointerDown={event => {
                skipClick.current = false;
                if (!arranging || event.button !== 0 || !garden.current) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { id: seed.id, x: event.clientX, y: event.clientY, start: [left, top], current: [left, top], moved: false };
              }}
              onPointerMove={event => {
                const active = drag.current, bounds = garden.current?.getBoundingClientRect();
                if (!active || active.id !== seed.id || !bounds) return;
                const dx = event.clientX - active.x, dy = event.clientY - active.y;
                if (!active.moved && Math.hypot(dx, dy) < 5) return;
                active.moved = true; setDragging(seed.id);
                active.current = constrain([active.start[0] + dx / bounds.width * 100, active.start[1] + dy / bounds.height * 100]);
                setCustom(previous => ({ ...previous, [seed.id]: active.current }));
              }}
              onPointerUp={() => {
                if (drag.current?.moved) { skipClick.current = true; saveLayout({ ...custom, [seed.id]: drag.current.current }); }
                drag.current = null; setDragging(null);
              }}
              onPointerCancel={() => {
                const start = drag.current?.start;
                if (start) setCustom(previous => ({ ...previous, [seed.id]: start }));
                drag.current = null; setDragging(null);
              }}
              onKeyDown={event => {
                const deltas: Record<string, Position> = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, -2], ArrowDown: [0, 2] };
                if (!arranging || !event.altKey || !deltas[event.key]) return;
                event.preventDefault();
                const [dx, dy] = deltas[event.key];
                saveLayout({ ...custom, [seed.id]: constrain([left + dx, top + dy]) });
              }}>
              <span className="plant-bed"><PlantSymbol state={state} /></span>
              <span className="plant-caption"><span className="plant-title">{seed.text}</span>
                <span className="plant-meta">{seed.owner || 'Unassigned'}<span className="meta-dot" />{growthLabels[state]}</span>
              </span>
            </button>
            {selected && !arranging && <div className="plant-quick-actions" aria-label={`Actions for ${seed.text}`}>
              {seed.status !== 'bloom' ? <>
                <button disabled={busy} aria-label={`Record progress for ${seed.text}`} onClick={() => onProgress(seed, false)}><Droplets size={14} />Tend</button>
                <button disabled={busy} aria-label={`Complete ${seed.text}`} onClick={() => onProgress(seed, true)}><Check size={14} />Complete</button>
              </> : <span><Check size={14} />A promise kept</span>}
              <button className="inspect-shortcut" aria-label={`View details for ${seed.text}`} onClick={() => onInspect(seed.id)}><ArrowUpRight size={16} /></button>
            </div>}
          </div>;
        })}
      </div>
    </div>
  </>;
}
