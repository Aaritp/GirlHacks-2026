# Person B — Grovekeeper 2.0

Implemented in the isolated `feat/ingest-slack` worktree based on main
`dbaba29`. Submitted on `feat/ingest-slack` for review; do not merge until the
foundation interfaces and live acceptance checks below are resolved.
The original checkout and its uncommitted camera-disable changes are preserved.

## Try the UI

From this worktree:

```sh
npm ci
npm run dev --workspace web -- --port 5174
```

Open http://127.0.0.1:5174 and choose **Add to grove**. Select Contoso, load the sample
email, import it, inspect the source quotes, and open the account grove. The shared
mock GroveApi holds the seeds used by both the importer and forest. Try a channel
ID such as C123456 in demo mode, then Sync again: the second sync imports nothing.
Draft follow-up reads the account's current mock seeds; edit and copy it.

Demo mode is explicitly labeled. It is not live AI/Slack. File parsing requires the
backend; mock uploads return an explicit 501. Browser mock data resets on reload.

## Implemented

- `POST /api/ingest`: account-scoped email/chat/text/document ingestion through
  the shared extraction model, validation/deduplication pipeline, and GroveStore.
- Email sender, To/Cc recipients and Date headers are retained. Chats support
  `[timestamp] Author: message`; structured messages retain author/date metadata.
  Unrecognized pasted formats remain raw text with Unknown author; no metadata is invented.
- TXT/Markdown UTF-8 and text-based PDFs are parsed on the backend. Limits: 5 MB,
  50 PDF pages, 100,000 text characters, 200 messages/chunks, bounded metadata.
  Empty, malformed, encrypted and scanned PDFs return actionable errors.
- Seeds carry accountId, original source type/id and a verbatim quote; non-meeting
  sources have no artificial meeting timestamp.
- A source stores its immutable extraction result before seed writes. Concurrent
  creates read the winning source. Retries reuse that result and existing seed IDs,
  recovering partial writes without resetting edited seed status/size.
- `POST /api/slack/sync`: server-only bot token, paginated channel history,
  users.info name resolution and mention expansion, account/channel binding,
  retry-safe per-message imports and durable append-only sync checkpoints.
- Checkpoints advance only after complete pagination and successful ingestion of
  the whole batch. Failures and rate limits are surfaced; no background sleeps or
  hidden retries. Repeat/concurrent syncs cannot rewind the high-water mark.
- `POST /api/accounts/{id}/followup`: uses shared complete_text with low reasoning,
  real account-scoped open commitments/recent decisions and latest source context.
  Editable subject/body and Copy only; no mail delivery exists.
- UI is keyboard/mouse only. No computer-vision branch code or MediaPipe dependency
  was brought into this worktree.

## Foundation handoff — required before live acceptance

Prisha's 2.0 account storage has not landed in current main. This implementation
does **not** create another account container/store or fake production accounts.
The real routes fail explicitly with 503 ACCOUNT_FOUNDATION_PENDING until these
shared store methods are supplied:

```python
get_account(account_id)                     # account model/dict, or None
list_account_seeds(account_id)               # all account seeds, including meetings
list_account_sources(account_id)             # all account sources, including meetings
```

The UI expects `GET /api/accounts -> { accounts: Account[] }`, where Account has
id, name, aliases, industry, contacts. Align this one client mapping if the shared
foundation chooses another response envelope. No production GET/accounts route is
implemented here: accounts remain Prisha's ownership.

Shared edits to review with Prisha:

- Additive nullable accountId/quote fields and new seed/source enum values in both
  wire-model files. Existing meeting records remain readable.
- Source text/messages/extractionItems plus internal recordType/channelId/syncTs.
  `extractionItems` is an internal retry plan, omitted from import responses.
- `list_sources(meeting_id)` added to both existing shared storage adapters. No
  new Cosmos containers, clients, credentials, partition keys or throughput.
- Optional Source parameter on the existing extraction pipeline; meeting callers
  retain the same signature and behavior. Citation quotes use actual chunk text.
- Existing extraction schema/prompt now accepts risk/customer_need and message dates.
- Three blueprint registrations and pypdf dependency.

Until a coordinated partition migration, ingestion uses A's existing /meetingId
partition key: `account-` plus the first 32 hex characters of SHA-256(accountId).
Every saved source/seed also has its true accountId. This is an ingestion partition,
not a fabricated meeting. Account-wide queries must include both these partitions
and real meetings. Person C can use returned source.meetingId to display imported
seeds immediately, then migrate to the shared account dashboard.

Slack bindings use existing sources storage in partition `slack-bindings`.
Checkpoints use the account ingestion partition. Timeline/source queries must filter
`recordType == "source"` so internal binding/checkpoint records never appear as
client interactions. Checkpoints are append-only for safe concurrent sync; compacting
old checkpoints is future maintenance for a larger deployment.

App.tsx adds the Add to grove view and a path back to the existing forest, reusing one
mock GroveApi. Person C should embed IngestPanel on the final account dashboard
instead of duplicating API calls or source persistence. Existing forest labels still
belong to C; its inspector must learn the expanded source/kind labels.

## Slack setup (not provisioned here)

No workspace or bot token was supplied, so live Slack provisioning/sync has not
been performed. An owner must:

1. Create/select the team's Slack workspace and demo public channels.
2. Create a Slack app and bot, with channels:history, channels:read and users:read.
3. Install it to that workspace and invite the bot to the chosen channels.
4. Set SLACK_BOT_TOKEN in ignored api/local.settings.json or server configuration.
   Never put it in VITE variables, requests from the browser or tracked files.
5. Choose the correct account, enter the channel ID and press Connect and sync.

Only public-channel user messages are imported. Bot/system events and edits are
skipped; thread replies require a separate conversations.replies integration and
are not advertised as supported. One configured workspace and one account per
channel are assumed. Rebinding requires an explicit future admin flow.
Very large/incomplete/free-tier-limited history is rejected before advancing a
checkpoint. Sync currently caps pagination at 20 pages / 1,000 fetched messages.

References: [Slack history](https://docs.slack.dev/reference/methods/conversations.history/),
[Slack pagination](https://api.slack.com/docs/pagination),
[pypdf](https://pypdf.readthedocs.io/en/latest/modules/PdfReader.html).

## Verification and remaining checks

Run:

```sh
npm test
npm run build
api/.venv/Scripts/python.exe -m pytest api/tests -q
```

Automated coverage includes both existing MemoryStore and CosmosStore backed by
the repository's fake Cosmos SDK: provenance, cross-account isolation, source
create races, partial-write retries, already-edited seeds, empty extraction, changing
Slack display names, checkpoint failure/retry, binding conflicts, pagination, 429,
document limits/PDFs, actual registered route behavior and redacted failures.
UI tests exercise import/citations, opening the saved grove, account switching,
preserving text after errors, editable draft copying and paste size limits.

Not yet verified: actual Azure OpenAI responses, actual Cosmos durability/restart,
Slack workspace/token/scopes, real browser reload across the final account
dashboard, or visual browser QA. The in-app browser automation connection failed
before opening a page. The required account methods are injected test doubles in
tests, not a substitute production implementation.

Live acceptance after foundation integration: ingest one email and one PDF, reload
the account dashboard and follow their citations; sync a new Slack message, sync
again with no duplicate seeds, then retry after a forced failure; draft from those
stored seeds and verify owners, dates and account isolation before copying.
