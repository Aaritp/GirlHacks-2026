# ADP demonstration — five minutes

Use a fictional payroll-onboarding client. Enter Alex in the transcript panel's
Your name field; that one name labels both microphone and Leaves contributions.
This branch includes main's accounts dashboard/backend and online capture.
Leaves context is still scoped to the selected meeting.

## 0:00–3:00 — core flow

| Time | Action and explanation |
| --- | --- |
| 0:00–0:25 | Open /?accounts and show the client's timeline/grove. State whether the data is sample or real. Choose Start a meeting: the route carries the account ID into both transcript and Leaves extraction. Mock account and meeting stores remain separate, so demonstrate cross-view persistence with the real backend only. |
| 0:25–1:00 | Enter Your name. In desktop Chrome/Edge, choose Share meeting tab and enable tab audio for the Zoom/Meet/Teams tab. Say “I'll send the payroll integration checklist by October 5.” Stop sharing to flush extraction. If services are unavailable, announce BACKUP A and use Play fixture transcript. |
| 1:00–1:20 | Inspect the saved commitment, owner, deadline and source timestamp in the forest. Refresh Leaves suggestions: they use persisted recent meeting context. Label fixture suggestions as fixtures. |
| 1:20–1:50 | Pick suggested words and type/spell Quetzal-X9. Build “I will review Quetzal-X9.” Explain that arbitrary spelling and direct preview editing are always available. |
| 1:50–2:15 | Confirm, then edit to “I will review Quetzal-X9 with Sam.” Show that Speak is disabled because editing revokes confirmation. |
| 2:15–2:45 | Confirm again and explicitly activate Speak using a click or Enter/Space. Let Azure Speech finish, then show the saved Leaves contribution/seed. Capture should be stopped to avoid recapturing synthesized audio. |
| 2:45–3:00 | Explain that playback initiation records the contribution; save/extraction retries retain its identity and never repeat audio. |

## 3:00–5:00 — value and architecture

| Time | Content |
| --- | --- |
| 3:00–3:35 | Show client account → meeting/text sources → shared extraction and Cosmos → source-backed seeds and account timeline. Clearly distinguish integrated account/backend/capture work from pending ingestion connections. |
| 3:35–4:10 | If the team's Slack integration has landed and passed preflight, demonstrate it. Otherwise use a labeled planned-flow diagram; do not present fixture data as live Slack. |
| 4:10–4:40 | Explain the ADP value: follow-through on client onboarding/payroll commitments, with owners, deadlines and evidence. Leaves lets a participant compose their own contribution without being limited to suggestions. |
| 4:40–5:00 | Close with remaining integration: ingestion, audio routing into the call, live service validation and user testing. |

Whiteboard OCR and hand/head tracking are dropped.

## Preflight

1. Run python -m pytest api/tests, npm test, npm run typecheck and npm run build.
2. Use VITE_USE_MOCKS=false and server-side Speech/OpenAI/Cosmos settings for the
   real run. Verify suggestion, confirmation, playback, save, extraction and reload.
3. Verify Chrome/Edge tab-audio sharing, the microphone and output device. Browser
   Speech plays locally; verify separately how the online call hears that output.
4. Resolve pending saves before changing Your name or reloading.
5. Prepare account-linked demo data through the shared backend. Verify each
   claimed ingestion/Slack connection rather than assuming it is available.
6. Rehearse twice with a timer. Optionally record a successful real-service run
   labeled with its date/branch. No recording is bundled.

## Backup material — announce every switch

- BACKUP A — mock core: fixture transcript, suggestions and deterministic mock
  extraction. Show spelling, editing and confirmation gating. Mock Speech rejects;
  do not claim audio played or a spoken contribution was saved. State resets on reload.
- BACKUP B — prerecorded real-service run: operator-provided recording of a
  successful rehearsal, explicitly labeled prerecorded. Not included in this repo.
- BACKUP C — tests: confirmation/playback, persisted-utterance retry, shared-name/
  clock integration and backend tests. Azure calls and Cosmos are faked; passing
  tests do not prove cloud access.

See services.md, integration.md and validation.md for setup and handoff.
