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
import { AskBox, MeetingAssistant } from './ask';
import type { Utterance } from './types';

// One API instance for every feature, so extracted seeds land in the grove the forest shows.
const groveApi = usingMocks ? createMockApi(createForestDemo()) : api;
const ingestApi = usingMocks ? createMockIngestApi(groveApi) : createIngestApi(import.meta.env.VITE_API_BASE_URL || '/api');

function MeetingGrove({ meetingId: initialMeetingId, accountId }: { meetingId: string; accountId: string | null }) {
  const [accountGrove, setAccountGrove] = useState<{ id: string; title: string } | null>(null);
  const [view, setView] = useState<'forest' | 'ingest'>('forest');
  const meetingId = accountGrove?.id ?? initialMeetingId;
  const title = accountGrove?.title ?? (meetingId === DEMO_MEETING_ID ? demoSource.title : `Meeting ${meetingId}`);
  // One meeting clock and one display name, owned by the app and shared with the transcript.
  const [meetingStartedAt] = useState(() => Date.now());
  const [userName, setUserName] = useState('');
  const [revision, setRevision] = useState(0);
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [questionActive, setQuestionActive] = useState(false);
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
              meetingStartedAt={meetingStartedAt} userName={userName} onUserNameChange={setUserName}
              onUtterancesChange={setUtterances} questionActive={questionActive} />
            <MeetingAssistant key={meetingId} api={groveApi} accountsApi={accountsApi}
              meetingId={meetingId} accountId={accountId} utterances={utterances} mockMode={usingMocks}
              onVoiceActiveChange={setQuestionActive} />
          </>}
      </ForestWorkspace>}
    </>
  );
}

export function App() {
  const parameters = new URLSearchParams(window.location.search);
  // `?accounts` lists client accounts and `?account=ID` opens one; anything else is a meeting grove.
  // `?meetingId=ID&accountId=ID` links that meeting's seeds to the account when they are extracted.
  if (parameters.has('accounts') || parameters.has('account')) {
    // Ask the Grove on an account page answers from that account only.
    return <AccountsApp api={accountsApi} demo={usingMocks} renderAsk={(accountId) =>
      <AskBox api={groveApi} accountsApi={accountsApi} accountId={accountId} mockMode={usingMocks} />} />;
  }
  return <MeetingGrove meetingId={parameters.get('meetingId') || DEMO_MEETING_ID} accountId={parameters.get('accountId') || null} />;
}
