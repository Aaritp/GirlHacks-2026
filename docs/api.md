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
503 `STORAGE_NOT_CONFIGURED`. The typed HTTP client throws `ApiError` with `status`,
`code`, and `message`. Validation responses do not echo meeting text or secrets.

## Foundation implementation status

Browser mocks support seed CRUD, utterance saves, fixture suggestions, word joining,
and deterministic per-utterance mock extraction. Speech and whiteboard mocks reject
with 501. HTTP supports health and opt-in memory seed/utterance storage; AI/Speech/OCR
remain explicit 501 integration points. Roots are fixture-only until persistence is
added. Do not mistake a passing scaffold health check for Azure service readiness.

Python uses separate blueprints for each owner; register new ones in `function_app.py`.
Add Cosmos, Speech, OpenAI, Vision, and Blob SDK dependencies when their integrations
are implemented. No cloud resources are created by this foundation.
