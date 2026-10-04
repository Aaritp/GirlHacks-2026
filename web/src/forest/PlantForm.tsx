import { useRef, useState } from 'react';
import { Sprout, X } from 'lucide-react';
import type { Seed } from '../types';

export function PlantForm({ meetingId, busy, onPlant, onClose }: {
  meetingId: string; busy: boolean; onPlant: (seed: Seed) => Promise<Seed | null>; onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [owner, setOwner] = useState('');
  const [deadline, setDeadline] = useState('');
  // Retain identity after failed requests: retries cannot create duplicate seeds.
  const id = useRef(crypto.randomUUID());
  return <aside className="inspector plant-form" tabIndex={-1} aria-label="Plant a seed">
    <div className="panel-heading"><h2>Plant a seed</h2><button className="icon-button" onClick={onClose} aria-label="Cancel planting"><X size={18} /></button></div>
    <div className="new-seed-symbol"><Sprout size={38} strokeWidth={1.4} /></div>
    <h3>Every promise starts here.</h3><p className="form-intro">Capture a next step from this meeting. You can add its owner and deadline now or later.</p>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (!text.trim() || busy) return;
      void onPlant({ id: id.current, meetingId, text: text.trim(), owner: owner.trim() || null,
        deadline: deadline || null, kind: 'commitment', status: 'seed', health: 1,
        sourceType: 'meeting', sourceId: meetingId, timestampSec: null, lastActivity: new Date().toISOString(), size: 1 });
    }}>
      <label>What needs to happen?<textarea autoFocus required rows={4} maxLength={500} placeholder="e.g. Send the updated checklist" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} /></label>
      <label>Owner <span className="optional">optional</span><input value={owner} maxLength={120} placeholder="Who will take this on?" onChange={(e) => setOwner(e.target.value)} disabled={busy} /></label>
      <label>Deadline <span className="optional">optional</span><input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} disabled={busy} /></label>
      <button type="submit" className="button primary full-width" disabled={busy || !text.trim()}><Sprout size={18} />{busy ? 'Planting…' : 'Plant seed'}</button>
    </form>
  </aside>;
}
