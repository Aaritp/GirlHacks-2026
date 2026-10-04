# Ask the Grove — frontend handoff

Branch: `feat/ask-assistant`, started from main `15e4cf0`. Uses the existing
`GroveApi.ask` request/response and backend-owned filters/citations. No API,
repository, storage, extraction or account-page implementation is replaced.

## Aarit: embed on the account page

```tsx
import { AskBox } from '../ask';

<AccountsApp
  api={accountsApi}
  demo={usingMocks}
  renderAsk={(accountId) => (
    <AskBox accountId={accountId} api={api} accountsApi={accountsApi} mockMode={usingMocks} />
  )}
/>
```

`api`, `accountsApi` and `mockMode` default to the existing shared instances and
mode, so `<AskBox accountId={accountId} />` also works. Supply the host's instances
when its fixtures differ. The account page is deliberately left for Aarit to wire.

Optional `onOpenCitation(citation)` hands source navigation to the host. Without it,
chips open the included inline source reader: full stored text for account sources,
or the meeting transcript scrolled to/highlighted at `timestampSec`. The reader
shows the cited quote, handles missing/deleted sources and restores focus on close.
Source identifiers are matched within their account and meeting, not by title.
It does not invent an external URL or play meeting audio.

The answer is rendered verbatim as text. `answered: false` always hides citation
chips, including a malformed response that still contains citations. Questions,
answers and pending responses reset on account/meeting scope changes. API failures
keep the typed question for retry. Asking never speaks, saves an utterance or
creates a seed.

## Live meeting integration

`MeetingAssistant` is mounted in App's meeting view, using the same GroveApi as
transcript and Leaves. It sends `accountId`, `meetingId` and `recentUtterances`.
The request contains at most 200 unique lines from that meeting (the backend limit),
ordered by timestamp; older saved evidence remains retrievable by the backend.

Small shared hooks:

- `TranscriptPanel.onUtterancesChange` publishes finalized lines, including restored
  transcript and lines whose save is pending/failed. Partial recognition text is not
  sent. The callback does not replace the existing save/extract flow.
- `LeavesPanel.onUtteranceStarted` publishes a contribution only when confirmed audio
  playback starts. Drafts and unconfirmed previews never become assistant context.
- App combines the two streams and scopes context by meeting. Ingestion and account
  dashboard routing are preserved.

## Voice questions

Hold the voice button with a pointer, or focus it and hold Space/Enter. Release to
finish; review the recognized question and choose Ask. Escape, window blur,
pointer cancellation and unmount cancel dictation. A 60-second cap ends recording.
Releasing before startup cancels even if microphone permission/token arrival is late.

`questionSpeech.ts` creates a separate Azure SpeechRecognizer and microphone stream
using the existing short-lived Speech token endpoint. No key is sent to the client.
The recognizer never calls utterance-save, extraction or speech-synthesis methods.
Recording resources are released on success, failure and cancellation. The meeting
microphone capture track is muted during question preparation, recording and
finalization; its recognizer receives silence with unchanged sample counts,
preserving timestamps. Other participants' tab audio continues. This mutes
Grovekeeper's transcript capture only, not the microphone in Zoom/Meet/Teams itself.
Questions can still be heard by people in the call unless that app is also muted.

Mock mode clearly labels keyword answers and disables voice recognition, since the
shared mock token endpoint intentionally refuses Speech. Tests inject an isolated
fake question recognizer. Live Speech needs the existing server configuration and
browser microphone permission; this branch does not claim real Azure verification.

## Mention context cards

Finalized transcript lines are matched locally against account names and aliases,
case-insensitively at word boundaries. Up to three recently mentioned accounts show
saved open commitments and risks, with evidence links. No automatic AI question is
issued, and no seeds are modified. Counts are derived from the fetched account
timeline; service failures are shown explicitly. Dismissal lasts until a new line
mentions that account. Refresh reloads saved context.

## Verification

Tests cover scope/200-line limits, unanswered results, stale account responses,
source text/timestamp navigation, API errors, account aliases and dismissal,
push-to-talk release/cancellation and late permission, SDK resource cleanup, and
the real App's transcript/Leaves context wiring. See `demo/ask-assistant.md` for
the manual demo/preflight path.

Pre-push checks: 155 frontend tests and 210 backend tests pass; `npm run typecheck`
and `npm run build` pass. Backend tests used Python 3.11.9 (3.12 is the documented
deployment target); Node was 24.21.0. Live Azure/microphone verification remains
part of preflight. Browser automation was unavailable in this workspace.
