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
| POST | `/extract` | `{ meetingId, utterances: Utterance[] }` | `{ seeds: Seed[], roots: Root[] }` |
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

Python uses separate blueprints for each owner; register new ones in `function_app.py`.
