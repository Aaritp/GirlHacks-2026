import { useCallback, useState } from 'react';
import { AccountsApp, accountsApi } from './accounts';
import { api, usingMocks } from './api';
import { createMockApi } from './api/mocks';
import { DEMO_MEETING_ID, demoSource } from './api/fixtures';
import { ForestWorkspace } from './forest/ForestWorkspace';
import { createForestDemo } from './forest/demo';
import { LeavesPanel } from './leaves/LeavesPanel';
import { TranscriptPanel } from './transcript/TranscriptPanel';

// One API instance for every feature, so extracted seeds land in the grove the forest shows.
const groveApi = usingMocks ? createMockApi(createForestDemo()) : api;

function MeetingGrove({ meetingId }: { meetingId: string }) {
  const title = meetingId === DEMO_MEETING_ID ? demoSource.title : `Meeting ${meetingId}`;
  const [meetingStartedAt] = useState(() => Date.now());
  const [userName, setUserName] = useState('');
  const meetingClock = useCallback(() => (Date.now() - meetingStartedAt) / 1000, [meetingStartedAt]);
  const [revision, setRevision] = useState(0);
  const reloadGrove = useCallback(() => setRevision((value) => value + 1), []);

  return (
    <ForestWorkspace api={groveApi} meetingId={meetingId} meetingTitle={title} demo={usingMocks} refreshSignal={revision}>
      <TranscriptPanel api={groveApi} meetingId={meetingId} onSeedsExtracted={reloadGrove}
        meetingStartedAt={meetingStartedAt} userName={userName} onUserNameChange={setUserName} />
      {userName.trim() && <LeavesPanel key={meetingId + ':' + userName} api={groveApi}
        meetingId={meetingId} speaker={userName} getStartSec={meetingClock}
        onSeeds={reloadGrove} mockMode={usingMocks} />}
    </ForestWorkspace>
  );
}

export function App() {
  const parameters = new URLSearchParams(window.location.search);
  // `?accounts` lists client accounts and `?account=ID` opens one; anything else is a meeting grove.
  if (parameters.has('accounts') || parameters.has('account')) return <AccountsApp api={accountsApi} demo={usingMocks} />;
  return <MeetingGrove meetingId={parameters.get('meetingId') || DEMO_MEETING_ID} />;
}
