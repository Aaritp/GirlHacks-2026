# Shared API contract

Base path: `/api`. Request and response bodies are JSON. Camel-case field names are
shared with `web/src/types.ts` and mirrored by Pydantic in `api/shared/models.py`.
Dates are `YYYY-MM-DD`; datetimes include a UTC offset (normally `Z`). IDs are nonempty
strings up to 128 characters without `/`, `\`, `?`, or `#`. Clients generate UUIDs for
new objects and retain IDs when retrying.

| Method | Route | Input | Successful response |
| --- | --- | --- | --- |
| GET | `/health` | — | `{ status, service, stage }` |
| POST | `/speech-token` | — | `{ token, region }` |
| POST | `/utterances` | `Utterance` | Saved `Utterance` |
| POST | `/extract` | `{ meetingId, utterances: Utterance[], accountId? }` | `{ seeds: Seed[], roots: Root[] }` |
| GET | `/meetings/{meetingId}/utterances` | — | `{ utterances: Utterance[] }` ordered by `startSec` |
| GET | `/accounts` | — | `Account[]` sorted by name |
| POST | `/accounts` | `Account` | Saved `Account` (201); 409 if the id exists |
| GET | `/accounts/{id}/timeline` | — | `{ accountId, items: [{ source: Source, seeds: Seed[] }] }` newest first |
| POST | `/seeds` | `Seed` | Saved `Seed` (201) |
| PATCH | `/seeds/{id}?meetingId=...` | `SeedPatch` | Updated `Seed` |
| GET | `/meetings/{meetingId}/grove` | — | `{ seeds, roots }` |
| POST | `/whiteboard` | `{ meetingId, imageBase64 }` | `{ text, seeds }` |
| POST | `/leaves/suggest` | `{ meetingId, recentText }` | `{ words, phrases }` |
| POST | `/leaves/compose` | `{ meetingId, picked: string[] }` | `{ sentence }` |

## Decisions clarified for integration

- PATCH includes `meetingId` as a query parameter because all four planned Cosmos
  containers use `/meetingId` as their partition key. The architecture left its
  location unspecified. Clients should use `api.updateSeed(meetingId, id, patch)`.
- PATCH permits only text, owner, deadline, kind, status, health, lastActivity and size.
  At least one field is required. Only owner and deadline may be set to null.
  IDs, meeting ID, and provenance are immutable. Clearing a value means sending null;
  omitting a field leaves it unchanged. Size is positive; health is 0–1.
- Last activity is currently caller-supplied. Agree on which actions refresh it before
  adding the health timer; resizing a note need not count as task progress.
- Creates reject duplicate seed IDs within a meeting (409). Utterance saves upsert by
  meeting/id so a Speech retry does not create duplicate text.
- Extract accepts 1–200 utterances belonging to the requested meeting. Its final
  implementation must persist results and deduplicate overlapping transcript windows,
  then return only the seeds/roots found in that request. Unknown owners/deadlines
  stay null; do not invent them. Typical cadence is 30 seconds of new transcript.
- For a meeting transcript, `sourceId` identifies its meeting Source (fixtures use
  the meeting ID). `timestampSec` provides the link back to the spoken context.
- Whiteboard uploads supply base64 image data. Their final owner must validate image
  format/size and create the Source before saving extracted seeds.
- Suggest targets 6–8 words and 3 phrases from roughly two minutes of context.
  Compose accepts user-spelled words too; it returns a preview and never triggers TTS.
- Features always call the `GroveApi` interface. Browser mocks retain changes for that
  instance only; reset by reloading. HTTP never silently falls back to mock success.

## Accounts and text sources

- Seed kinds: `commitment`, `decision`, `risk`, `customer_need`. Source types: `meeting`,
  `whiteboard`, `email`, `chat`, `document`, `slack`. Seeds may also be `leaves`.
- `Seed.accountId` and `Seed.quote`, and `Source.accountId` and `Source.text`, are optional and
  null when absent, so data stored before accounts still loads. `quote` is the exact source
  wording: for meetings, the cited utterances; for text sources, a span verified verbatim in
  `Source.text`. Items whose quote is not in the source are dropped, never saved.
- Non-meeting sources use their own id as `meetingId`, so `PATCH /seeds/{id}?meetingId=` works
  unchanged for every seed. Their seeds have `timestampSec: null`.
- `/extract` with `accountId` links the meeting's Source to that account on first use; later
  windows inherit it. A different `accountId` for an already-linked meeting → 409 `CONFLICT`.
- Text sources (email, chat, document, Slack) are ingested by `api/ingest`, which saves the
  Source and calls `extract_and_save(..., source=source)` with utterance-shaped chunks of its
  text. Those chunks are evidence only: they are not saved as utterances, and the seeds point at
  the source (`sourceType` = source type, `sourceId` = source id, `timestampSec: null`).
- `GET /meetings/{id}/utterances` returns an empty list for an unknown meeting (not 404).
- `GET /accounts/{id}/timeline` returns every Source of the account, newest `createdAt` first,
  each with the seeds extracted from it (`seeds` is empty when there are none). Unknown
  account → 404 `NOT_FOUND`; an account with no sources → 200 with empty `items`. Records of
  another account, and bookkeeping records stored as sources (`recordType` other than
  `source`), are never included. Meeting sources have null `text`; read their transcript
  with `GET /meetings/{id}/utterances`.

## Errors

```json
{ "error": { "code": "NOT_FOUND", "message": "Seed not found." } }
```

400 `INVALID_REQUEST`, 404 `NOT_FOUND`, 409 `CONFLICT`, 501 `NOT_IMPLEMENTED`,
502 `UPSTREAM_ERROR` (Azure Speech/OpenAI failed), 503 `STORAGE_NOT_CONFIGURED`,
503 `STORAGE_UNAVAILABLE` (configured storage failed), 503 `SERVICE_NOT_CONFIGURED`
(Azure service settings missing; the message names the setting, never its value).
The typed HTTP client throws `ApiError` with `status`, `code`, and `message`.
Validation responses do not echo meeting text or secrets.

## Implementation status

Storage: Cosmos DB or explicit memory mode for seeds, roots, utterances and sources; see
[storage.md](storage.md) for the shared `GroveStore` interface. `getGrove` now returns
persisted roots.

`/speech-token` exchanges the server-held Speech key for a 10-minute token
(`Cache-Control: no-store`). The browser streams mic audio straight to Azure Speech
with speaker diarization (`ConversationTranscriber`) and refreshes the token every 9 minutes.

`/extract` saves the meeting Source and the request's utterances, asks Azure OpenAI
(structured outputs) for commitments and decisions, then validates the result:
- Each item must cite utterance IDs from the request; items without them are dropped.
  `timestampSec` is the earliest cited utterance's `startSec`; `sourceId` is the meeting.
- Owner is kept only if it is a cited speaker label (not "Unknown speaker") or a name in
  the cited text. Deadline is kept only if it is a valid date and its quoted evidence
  appears in the cited text. Otherwise both stay null.
- Deduplication: same kind + same anchor timestamp + similar text, or a near-identical
  restatement with a compatible owner, returns the existing seed unchanged (progress is
  preserved). New seed/root IDs are deterministic, so concurrent retries resolve to one.
- Model failure → 502 with no seeds created. Missing OpenAI settings → 503 before saving.

Browser mocks still provide deterministic per-utterance extraction (not AI) and reject
Speech with 501. Leaves and whiteboard endpoints remain 501 integration points.

Azure OpenAI: use `api/shared/openai_client.py` (`complete_json` / `complete_text`) for any
model call. It targets reasoning deployments such as gpt-5-mini: it sends `reasoning_effort`
and optional `max_completion_tokens`, and never `temperature`, `top_p` or `max_tokens`.
Extraction uses effort `low`; Whispering Leaves should use `minimal`.

Azure SDK request logging is limited to warnings (`GROVEKEEPER_SDK_LOG_LEVEL=INFO` restores it).

Python uses separate blueprints for each owner; register new ones in `function_app.py`.
