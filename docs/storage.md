# Shared storage adapter

Owner: Person A (transcription/extraction), as primary owner of `api/shared/store.py`
and `api/shared/cosmos.py`. Propose interface changes before editing these files.

## Using it from a blueprint

```python
from shared.store import get_store, storage_errors

@bp.route(route="whiteboard", methods=["POST"])
@validated          # outermost: request validation errors -> 400
@storage_errors     # StorageNotConfigured / StorageUnavailable -> 503
def whiteboard(req):
    request = WhiteboardRequest.model_validate(req.get_json())
    store = get_store()
    ...
```

Validate the request body before calling `get_store()` so bad input is still a 400 when
storage is not configured. Do not catch storage exceptions yourself and return success.

## Selection

| `GROVEKEEPER_STORAGE_MODE` | Result |
| --- | --- |
| `cosmos` | Cosmos DB. Missing `AZURE_COSMOS_ENDPOINT`/`AZURE_COSMOS_KEY` → 503 `STORAGE_NOT_CONFIGURED`. |
| `memory` | Process-local development store. Lost on restart; not shared between workers. |
| unset | Cosmos when `AZURE_COSMOS_ENDPOINT` is set, otherwise 503 `STORAGE_NOT_CONFIGURED`. |
| anything else | 503 `STORAGE_NOT_CONFIGURED`. |

There is no fallback: a configured Cosmos that fails returns 503 `STORAGE_UNAVAILABLE`,
never memory data. `AZURE_COSMOS_DATABASE` defaults to `grovekeeper`.

## `GroveStore` interface

All methods take or return the Pydantic models in `api/shared/models.py`, and return
copies. Every lookup is scoped by `meetingId`; IDs only need to be unique within a meeting.

| Method | Returns | Notes |
| --- | --- | --- |
| `create_seed(seed)` | `Seed \| None` | `None` if `(meetingId, id)` exists. Never overwrites. |
| `get_seed(meeting_id, seed_id)` | `Seed \| None` | |
| `list_seeds(meeting_id)` | `list[Seed]` | |
| `patch_seed(meeting_id, seed_id, patch)` | `Seed \| None` | `None` if missing. Only `SeedPatch` fields change; Cosmos applies them atomically. |
| `create_root(root)` | `Root \| None` | `None` if it exists. |
| `list_roots(meeting_id)` | `list[Root]` | |
| `save_utterance(utterance)` | `Utterance` | Upsert by `(meetingId, id)`; Speech retries do not duplicate. |
| `list_utterances(meeting_id)` | `list[Utterance]` | Sorted by `startSec`. |
| `create_source(source)` | `Source \| None` | `None` if it exists. |
| `get_source(meeting_id, source_id)` | `Source \| None` | |
| `get_grove(meeting_id)` | `Grove` | Seeds and roots of one meeting. |

Errors: `StorageNotConfigured` and `StorageUnavailable` (both map to 503 via
`storage_errors`). A stored document that fails model validation raises
`StorageUnavailable`, not a client 400.

Use deterministic IDs when an operation may be retried (extraction derives seed and root
IDs from meeting, kind, source utterance and text), so a conflict means "already done":
`store.create_seed(seed) or store.get_seed(seed.meetingId, seed.id)`.

## Cosmos layout

Containers `seeds`, `roots`, `utterances`, `sources`, each partitioned on `/meetingId`.
Documents are the wire models' JSON plus Cosmos system fields (stripped on read). The adapter
creates the database and containers if missing on first use (works for serverless and
provisioned accounts). Queries always pass `partition_key`, so no request crosses meetings.

Not yet provided: cross-meeting scans (needed by a health timer) and deletes. Ask before
adding them so both backends and the contract tests in `api/tests/test_store.py` stay in sync.

## Testing

`api/tests/test_store.py` runs the same contract against `MemoryStore` and `CosmosStore`
backed by `tests/fake_cosmos.py`, which raises real SDK exceptions. Use
`shared.store.use_store(instance)` to inject a store in handler tests and `use_store(None)`
to restore. The fake is not a substitute for a smoke test against a real account.
