import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { GroveEvent } from '../types';
import { InputSurface } from './InputSurface';
import type { FeatureInputActions } from './actions';

// Standalone input diagnostics: deliberately has no feature actions or storage.
function Preview() {
  const [events, setEvents] = useState<GroveEvent[]>([]);
  const [error, setError] = useState('');
  const actions = useMemo<FeatureInputActions>(() => {
    const record = (event: GroveEvent) => setEvents((previous) => [event, ...previous].slice(0, 8));
    return { point() {}, dwell() {}, select: record, plant: record, resize: record, confirm: record, dismiss: record };
  }, []);
  return <main style={{ fontFamily: 'system-ui', maxWidth: 850, margin: '2rem auto', padding: '1rem' }}>
    <h1>Input preview</h1>
    <p>Diagnostics only. Actions below appear in the event log; this page does not save seeds.</p>
    <InputSurface actions={actions} onError={(reason) => setError(String(reason))}>
      <div data-grove-target="preview-seed" style={{ border: '2px solid #256c40', padding: '3rem', margin: '1rem 0' }}>
        Pinch to move here, release to park, then tap middle finger to thumb to select. In head mode, dwell here.
      </div>
    </InputSurface>
    {error && <p role="alert">{error}</p>}
    <h2>Recent commands</h2><pre>{JSON.stringify(events, null, 2)}</pre>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
