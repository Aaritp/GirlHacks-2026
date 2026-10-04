# ADP demonstration — five minutes

Real run: `VITE_USE_MOCKS=false`, `func start` with Speech, OpenAI, Cosmos and the Slack token
configured, and demo data loaded with `python3 scripts/seed_demo_data.py` (Contoso, Fabrikam,
Northwind). Use desktop Chrome or Edge, with the Meet call in another tab of the same window.

| Time | Action and explanation |
| --- | --- |
| 0:00–0:30 | **Hook.** "A rep joins a renewal call. What did we promise this client?" Open Client accounts → Contoso: timeline of emails, chat, document and meetings; seeds as a grove. |
| 0:30–1:30 | **Ingest.** Add to grove → Contoso → paste an email → Add to grove: seeds appear with quotes. Post a message in #contoso, then Connect and sync: Slack becomes seeds. "Slack is live; Gmail and Teams use the same pipeline." |
| 1:30–3:00 | **Live call.** From Contoso, Start a meeting → enter Your name → Share meeting tab (tab audio on). Speak: commitments appear with owners and dates; rename Guest-1 to the other person. Saying "Contoso" shows the client context card. Say "the payroll integration checklist is done" → Mark as done? → Yes → the seed blooms on Contoso's page. |
| 3:00–4:00 | **Ask mid-call.** Hold to ask by voice (or type): "What did Contoso say about payroll integration?" → cited answer; chips open the source. Your question is not added to the transcript. Optionally ask "What are the open commitments for Fabrikam?" (overdue item called out). |
| 4:00–4:30 | **Next action.** Add to grove → Draft follow-up for the account → an editable email built from real seeds. Nothing is sent automatically. |
| 4:30–5:00 | **Close.** Azure architecture: Browser → Azure Functions → Azure AI Speech, Azure OpenAI (gpt-5-mini), Cosmos DB, plus Slack. Roadmap: more connectors, vector search, completions from email/Slack. |

Mute: Zoom/Meet/Teams' mute does not reach Grovekeeper; use Mute my mic in the transcript panel.

## Preflight

1. Run `python -m pytest api/tests`, `npm test`, `npm run typecheck` and `npm run build`.
2. Restart `func start` after any settings change; confirm `GET /api/health`.
3. Check the three demo questions with Ask the Grove before going live.
4. Sync each Slack channel once in advance so the live sync shows only the new message.
5. Rehearse twice with a timer.

## Backup — announce every switch

- **A — prerecorded run:** a recording of a successful real rehearsal, labeled as prerecorded.
- **B — mock mode:** `VITE_USE_MOCKS=true` uses fixtures and deterministic, clearly labeled
  non-AI extraction and answers; Speech is unavailable. Never present it as live AI.

See [ask-assistant.md](ask-assistant.md) for the Ask the Grove and live-assistant details.
