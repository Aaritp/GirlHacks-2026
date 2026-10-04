import { useCallback, useState } from 'react';
import { AccountsApp, accountsApi } from './accounts';
import { api, usingMocks } from './api';
import { createMockApi } from './api/mocks';
import { DEMO_MEETING_ID, demoSource } from './api/fixtures';
import { ForestWorkspace } from './forest/ForestWorkspace';
import { createForestDemo } from './forest/demo';
import { TranscriptPanel } from './transcript/TranscriptPanel';
import { IngestPanel } from './ingest/IngestPanel';
import { createIngestApi } from './ingest/api';
import { createMockIngestApi } from './ingest/mocks';

// One API instance for every feature, so extracted seeds land in the grove the forest shows.
const groveApi = usingMocks ? createMockApi(createForestDemo()) : api;
const ingestApi = usingMocks ? createMockIngestApi(groveApi) : createIngestApi(import.meta.env.VITE_API_BASE_URL || '/api');

function MeetingGrove() {
  const parameters = new URLSearchParams(window.location.search);
  const [accountGrove, setAccountGrove] = useState<{ id: string; title: string } | null>(null);
  const [view, setView] = useState<'forest' | 'ingest'>('forest');
  const meetingId = accountGrove?.id ?? (parameters.get('meetingId') || DEMO_MEETING_ID);
  const title = accountGrove?.title ?? (meetingId === DEMO_MEETING_ID ? demoSource.title : `Meeting ${meetingId}`);
  const [revision, setRevision] = useState(0);
  const reloadGrove = useCallback(() => setRevision((value) => value + 1), []);

  return (
    <>
      <nav aria-label="Workspaces" style={{ padding: 12, display: 'flex', gap: 12 }}>
        <button type="button" aria-pressed={view === 'forest'} onClick={() => setView('forest')}>Grove</button>
        <button type="button" aria-pressed={view === 'ingest'} onClick={() => setView('ingest')}>Add to grove</button>
      </nav>
      {view === 'ingest' ? <IngestPanel api={ingestApi} mock={usingMocks} onOpenGrove={(id, accountTitle) => {
        setAccountGrove({ id, title: accountTitle }); reloadGrove(); setView('forest');
      }} /> : <ForestWorkspace api={groveApi} meetingId={meetingId} meetingTitle={title} demo={usingMocks} refreshSignal={revision}>
        {accountGrove ? <button type="button" onClick={() => setAccountGrove(null)}>Return to meeting</button>
          : <TranscriptPanel api={groveApi} meetingId={meetingId} onSeedsExtracted={reloadGrove} />}
      </ForestWorkspace>}
    </>
  );
}

export function App() {
  const parameters = new URLSearchParams(window.location.search);
  if (parameters.has('accounts') || parameters.has('account')) return <AccountsApp api={accountsApi} demo={usingMocks} />;
  return <MeetingGrove />;
}
