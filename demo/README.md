# ADP demonstration — five minutes

Fictional client: an onboarding customer preparing a payroll integration.
Leaves participant: Alex. The product direction is one grove per client account,
fed by online meetings, Slack, and pasted/uploaded email, chat, and documents.

This branch integrates Person C's forest and Leaves on main dbaba29. The current
wire contract is still meeting-scoped. Account types/storage, tab-audio capture,
and Slack/ingestion are team dependencies, not completed features in this checkout.

## 0:00–3:00 — core flow

| Time | Action | Talk track and evidence |
| --- | --- | --- |
| 0:00–0:25 | Open the client's onboarding session and show the service-mode label. | “Each client will have a grove of traceable commitments. This build demonstrates the meeting source while account grouping is integrated.” If the shared account UI has landed, select the actual client instead. |
| 0:25–1:00 | With the team's tab-capture integration ready, explicitly share a Zoom/Meet/Teams tab with audio and extract an onboarding commitment. Otherwise announce **fixture transcript**, then use Play fixture transcript. | Alex: “I'll send the payroll integration checklist by October 5.” Sam: “I'll schedule the onboarding review after the checklist is ready.” The old microphone path is disabled; do not present an in-person flow. |
| 1:00–1:20 | Inspect the resulting seed in Person C's forest and show its owner, deadline and source timestamp. Refresh Leaves suggestions. | “These suggestions use the saved recent context from this session.” Fixture suggestions are labeled as fixtures, not live AI. |
| 1:20–1:50 | Use mouse or keyboard to choose words and type/spell “Quetzal-X9.” Build “I will review Quetzal-X9.” | “Suggestions are shortcuts. I can always use my own spelling and edit the preview.” |
| 1:50–2:15 | Confirm the preview, then edit it to “I will review Quetzal-X9 with Sam.” Point out Speak is disabled. | “Confirmation belongs to the exact preview. Any edit revokes it.” |
| 2:15–2:45 | Confirm again, then separately activate Speak with Enter/Space or a click. | Let Azure Speech finish. Show the saved Leaves contribution/new seed in the same forest. Pause transcript capture first to avoid recapturing synthesized speech as a second voice contribution. |
| 2:45–3:00 | Inspect the saved seed and describe retry behavior. | “Only playback initiation records the utterance. Save retries keep its ID and never repeat the audio.” |

## 3:00–5:00 — value and architecture

| Time | Content |
| --- | --- |
| 3:00–3:35 | Show the architecture: client account → online meeting / Slack / pasted or uploaded content → shared extraction and Cosmos → traceable grove. Distinguish working meeting-scoped paths from pending account/ingest paths. |
| 3:35–4:10 | If Person B's live Slack integration is ready, show one authorized channel contribution reaching the same client grove. Otherwise explain the planned connector and clearly label its fixture or diagram. Do not show a fabricated live sync. |
| 4:10–4:40 | ADP relevance: follow-through on client onboarding and payroll commitments; a useful answer to “What did we discuss with this client?” grounded in traceable sources. Do not claim account-wide retrieval until it is implemented. |
| 4:40–5:00 | Show next steps and close: shared account contract, completed online capture/ingestion, user testing of the keyboard flow, access control and retention. |

Whiteboard OCR, hand/head tracking, and in-person capture are outside this active
demo. Do not spend core time on those older features.

## Preflight

1. Run `npm ci`, `npm run build`, `npm test`, and `python -m pytest api/tests`.
2. For Azure services use `VITE_USE_MOCKS=false`; configure Speech, OpenAI, and
   shared Cosmos settings from `services.md`. Verify a real suggestion, confirmed
   playback, utterance save, extraction, and grove reload with fictional data.
3. Verify speaker identity, output device and browser audio permissions. Resolve
   pending saves before changing participant or reloading; retries are panel-local.
   Confirm how browser speech reaches the online call; this branch plays audio
   locally and does not inject it into a meeting platform's microphone stream.
4. Verify tab-audio capture and Slack only after their owners' branches land.
   Without those integrations, use the explicitly labeled backup path above.
5. Rehearse twice with a timer. Record a successful run separately and label it
   “PRERECORDED — real Azure services, date/branch.” No recording is included here.

## Backup material — announce every switch

- **BACKUP A — mock core:** browser fixture transcript, fixture suggestions and
  deterministic extraction in the same mock forest. Show native editing and
  confirmation gating. Mock Speech rejects; do not pretend audio played or a
  spoken contribution was saved. Mock state resets on reload.
- **BACKUP B — prerecorded real-service run:** operator-provided recording from a
  successful rehearsal. It is not live. No such recording is bundled.
- **BACKUP C — test evidence:** show the confirmation/playback tests, the
  Leaves-to-forest integration test, and backend persistence tests. Azure calls
  and Cosmos are faked in these tests; passing tests do not prove cloud access.
- **ARCHIVED — whiteboard:** `whiteboard.png`, its generator, OCR source and tests
  remain available as inactive historical material. They are not part of the
  new five-minute presentation.

See `integration.md` for the team handoff and `validation.md` for verification.
