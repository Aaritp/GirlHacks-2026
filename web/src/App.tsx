import { useCallback, useState } from 'react';
import { api, usingMocks } from './api';
import { createMockApi } from './api/mocks';
import { DEMO_MEETING_ID, demoSource } from './api/fixtures';
import { ForestWorkspace } from './forest/ForestWorkspace';
import { createForestDemo } from './forest/demo';
import { LeavesPanel } from './leaves/LeavesPanel';
import { TranscriptPanel } from './transcript/TranscriptPanel';

// One API instance for every feature, so extracted seeds land in the grove the forest shows.
const groveApi = usingMocks ? createMockApi(createForestDemo()) : api;

export function App() {
  const parameters = new URLSearchParams(window.location.search);
  const meetingId = parameters.get('meetingId') || DEMO_MEETING_ID;
  const title = meetingId === DEMO_MEETING_ID ? demoSource.title : `Meeting ${meetingId}`;
  const [meetingStartedAt] = useState(() => Date.now());
  const [speaker, setSpeaker] = useState('Alex');
  const meetingClock = useCallback(() => (Date.now() - meetingStartedAt) / 1000, [meetingStartedAt]);
  const [revision, setRevision] = useState(0);
  const reloadGrove = useCallback(() => setRevision((value) => value + 1), []);

  return (
    <ForestWorkspace api={groveApi} meetingId={meetingId} meetingTitle={title} demo={usingMocks} refreshSignal={revision}>
      <p role="status">Online meeting capture from a shared Zoom, Meet, or Teams tab is awaiting integration.
        The fixture transcript below is development data.</p>
      <TranscriptPanel api={groveApi} meetingId={meetingId} onSeedsExtracted={reloadGrove}
        meetingStartedAt={meetingStartedAt} allowMicrophone={false} />
      <label className="leaves-participant">Leaves participant (demo default: Alex)
        <input value={speaker} onChange={(event) => setSpeaker(event.target.value)} />
      </label>
      {speaker.trim() && <LeavesPanel key={meetingId + ':' + speaker} api={groveApi}
        meetingId={meetingId} speaker={speaker} getStartSec={meetingClock}
        onSeeds={reloadGrove} mockMode={usingMocks} />}
    </ForestWorkspace>
  );
}
