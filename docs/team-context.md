# AI context block (current)

Copy this whole block into your AI chat before asking for help, so every assistant on the team
works from the same plan. It replaces the older block in "Grovekeeper — Team Architecture"
(hand gestures, head tracking, whiteboard and Whispering Leaves are no longer in scope).

```markdown
PROJECT CONTEXT — Grovekeeper 2.0 (hackathon, theme: Enchanted Grove)

What it is: A client-account workspace. It turns every client conversation (online meetings,
email, chat, documents, Slack) into "seeds" in one grove per client account, so nothing promised
to a client gets lost. Seeds are commitments, decisions, risks and customer needs, each with an
owner, a deadline and an exact quote from its source.

Sponsor tracks: ADP "AI for the Modern Enterprise" + Avanade "Best Use of Azure".

Stack:
- Frontend: React + Vite + TypeScript (web/). One typed API client: web/src/api (GroveApi).
- Backend: Azure Functions, Python (api/), Pydantic models in api/shared/models.py mirrored in
  web/src/types.ts. Storage through get_store() in api/shared/store.py (Cosmos or memory).
- Azure AI Speech: live transcription. Meeting tab = diarized; user's mic = plain recognizer
  labelled with their name. Browser gets short-lived tokens from /api/speech-token only.
- Azure OpenAI (gpt-5-mini, a reasoning model): use api/shared/openai_client.py
  (complete_json / complete_text). Send reasoning_effort; never temperature, top_p or max_tokens.
- Azure Cosmos DB: containers seeds, roots, utterances, sources (partition /meetingId) and
  accounts (partition /id), on shared database throughput.
- Slack: read-only bot, manual Sync per channel (api/slack_sync).

Features (all on main): online meeting capture (Share meeting tab, Mute my mic, speaker
rename), extraction every ~30 s, self-updating commitments (confirm before bloom), ingest
(paste/upload email, chat, .txt/.md/.pdf), Slack sync, account dashboard + timeline, Ask the
Grove (POST /api/ask: filter → retrieve → cited answer, or "I don't have that"), live in-meeting
assistant (push-to-talk, context cards), follow-up email drafts, Clear all data (dev only).

Rules: never invent owners or deadlines; every seed and answer cites a stored source; nothing is
marked done or sent without user confirmation; secrets only in api/local.settings.json or Azure
app settings, never in VITE_* or git. Out of scope: hand/head tracking, whiteboard OCR,
Whispering Leaves.

Demo data: python3 scripts/seed_demo_data.py (Contoso, Fabrikam, Northwind).
```
