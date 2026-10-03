import { useCallback, useEffect, useState } from 'react';
import { api, usingMocks } from './api';
import { DEMO_MEETING_ID } from './api/fixtures';
import { TranscriptPanel } from './transcript/TranscriptPanel';
import type { Grove } from './types';

// Development entry point; each owner builds their feature in its own folder.
export function App() {
  const [grove, setGrove] = useState<Grove | null>(null);
  const [error, setError] = useState('');

  const [revision, setRevision] = useState(0);
  const reloadGrove = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    api.getGrove(DEMO_MEETING_ID).then(
      (value) => { if (active) { setGrove(value); setError(''); } },
      (reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to load grove');
      },
    );
    return () => { active = false; };
  }, [revision]);

  return (
    <main>
      <h1>Grovekeeper</h1>
      <p>Turn meeting commitments into a living forest.</p>
      <p>Development scaffold · {usingMocks ? 'Browser mocks' : 'Local API'}</p>
      {error ? <p role="alert">{error}</p> : !grove ? <p role="status">Loading grove…</p> : (
        <section aria-labelledby="commitments">
          <h2 id="commitments">Sample commitments</h2>
          {grove.seeds.length === 0 ? <p>No seeds yet.</p> : (
            <ul>{grove.seeds.map((seed) => (
              <li key={seed.id}>{seed.text} — {seed.owner ?? 'Unassigned'} ({seed.status})</li>
            ))}</ul>
          )}
        </section>
      )}
      <TranscriptPanel api={api} meetingId={DEMO_MEETING_ID} onSeedsExtracted={reloadGrove} />
    </main>
  );
}
