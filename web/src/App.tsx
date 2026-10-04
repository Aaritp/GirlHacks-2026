import { useCallback, useState } from 'react';
import { api, usingMocks } from './api';
import { createMockApi } from './api/mocks';
import { DEMO_MEETING_ID, demoSource } from './api/fixtures';
import { ForestWorkspace } from './forest/ForestWorkspace';
import { createForestDemo } from './forest/demo';
import { TranscriptPanel } from './transcript/TranscriptPanel';

// One API instance for every feature, so extracted seeds land in the grove the forest shows.
const groveApi = usingMocks ? createMockApi(createForestDemo()) : api;

export function App() {
  const parameters = new URLSearchParams(window.location.search);
  const meetingId = parameters.get('meetingId') || DEMO_MEETING_ID;
  const title = meetingId === DEMO_MEETING_ID ? demoSource.title : `Meeting ${meetingId}`;
  const [revision, setRevision] = useState(0);
  const reloadGrove = useCallback(() => setRevision((value) => value + 1), []);

  return (
    <ForestWorkspace api={groveApi} meetingId={meetingId} meetingTitle={title} demo={usingMocks} refreshSignal={revision}>
      <TranscriptPanel api={groveApi} meetingId={meetingId} onSeedsExtracted={reloadGrove} />
    </ForestWorkspace>
  );
}
