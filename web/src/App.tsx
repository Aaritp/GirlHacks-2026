import { useCallback, useState } from 'react';
import { AccountsApp, accountsApi } from './accounts';
import { api, usingMocks } from './api';
import { createMockApi } from './api/mocks';
import { DEMO_MEETING_ID, demoSource } from './api/fixtures';
import { ForestWorkspace } from './forest/ForestWorkspace';
import { createForestDemo } from './forest/demo';
import { LeavesPanel } from './leaves/LeavesPanel';
import { TranscriptPanel } from './transcript/TranscriptPanel';
import { IngestPanel } from './ingest/IngestPanel';
import { createIngestApi } from './ingest/api';
import { createMockIngestApi } from './ingest/mocks';

// One API instance for every feature, so extracted seeds land in the grove the forest shows.
const groveApi = usingMocks ? createMockApi(createForestDemo()) : api;
const ingestApi = usingMocks ? createMockIngestApi(groveApi) : createIngestApi(import.meta.env.VITE_API_BASE_URL || '/api');

function MeetingGrove({ meetingId: initialMeetingId, accountId }: { meetingId: string; accountId: string | null }) {
  const [accountGrove, setAccountGrove] = useState<{ id: string; title: string } | null>(null);
  const [view, setView] = useState<'forest' | 'ingest'>('forest');
  const meetingId = accountGrove?.id ?? initialMeetingId;
  const title = accountGrove?.title ?? (meetingId === DEMO_MEETING_ID ? demoSource.title : `Meeting ${meetingId}`);
  // One meeting clock and one display name, shared by the transcript and Whispering Leaves.
  const [meetingStartedAt] = useState(() => Date.now());
  const [userName, setUserName] = useState('');
  const meetingClock = useCallback(() => (Date.now() - meetingStartedAt) / 1000, [meetingStartedAt]);
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
          : <>
            {accountId && <p><a href={`?account=${encodeURIComponent(accountId)}`}>Back to this meeting's client account</a></p>}
            <TranscriptPanel api={groveApi} meetingId={meetingId} accountId={accountId} onSeedsExtracted={reloadGrove}
              meetingStartedAt={meetingStartedAt} userName={userName} onUserNameChange={setUserName} />
            {userName.trim() && <LeavesPanel key={meetingId + ':' + userName} api={groveApi}
              meetingId={meetingId} accountId={accountId} speaker={userName} getStartSec={meetingClock}
              onSeeds={reloadGrove} mockMode={usingMocks} />}
          </>}
      </ForestWorkspace>}
    </>
  );
}

export function App() {
  const parameters = new URLSearchParams(window.location.search);
  // `?accounts` lists client accounts and `?account=ID` opens one; anything else is a meeting grove.
  // `?meetingId=ID&accountId=ID` links that meeting's seeds to the account when they are extracted.
  if (parameters.has('accounts') || parameters.has('account')) return <AccountsApp api={accountsApi} demo={usingMocks} />;
  return <MeetingGrove meetingId={parameters.get('meetingId') || DEMO_MEETING_ID} accountId={parameters.get('accountId') || null} />;
}
