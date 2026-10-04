# Grovekeeper

A meeting productivity app that turns commitments and decisions into seeds in a
living forest, with mouse, hand and head controls. Whispering Leaves will let people
compose and confirm speech using the meeting's context.

This repository contains the **shared foundation and Person C's forest workspace**.
The forest includes garden/list views, editable seeds, progress actions, dependency
roots, shared-input handling, and seed-health logic. Other owners' real integrations
are still in progress. Shared contracts, fixtures, a typed API client, one input bus,
and a Python Azure Functions scaffold support parallel work.

## Run the frontend

Install Node.js 22.12+ (Node 24 recommended), then from the repository root:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Development uses browser mocks by default and
shows a sample garden. Changes in demo mode reset on reload. No Azure account is needed. To configure explicitly, copy
`web/.env.example` to `web/.env`. Changes to environment settings require a restart.

```sh
npm run typecheck
npm test
npm run build
```

Production builds default to HTTP, not fixtures. To deliberately build a mock-only
preview, set `VITE_USE_MOCKS=true` before building. The placeholder page identifies
the mode. The UI and real integrations belong to the feature owners.

## Run the local backend

Install Python 3.12 and Azure Functions Core Tools v4. From the repository root:

```sh
python -m venv api/.venv
```

Activate with `api\.venv\Scripts\Activate.ps1` in PowerShell or
`source api/.venv/bin/activate` on macOS/Linux. Then:

```sh
python -m pip install -r api/requirements-dev.txt
python -m pytest api/tests
```

Copy `api/local.settings.example.json` to `api/local.settings.json`, then:

```sh
cd api
func start
```

The API runs on port 7071. Set `VITE_USE_MOCKS=false` in `web/.env` and restart Vite;
its `/api` proxy forwards requests to the local backend. Use `/?meetingId=YOUR_MEETING_ID`
to open a specific grove. Test `GET /api/health`.
The local backend starts with an empty grove; `POST /api/seeds` populates it.

`GROVEKEEPER_STORAGE_MODE=memory` explicitly enables development-only storage.
Data is lost on restart and is not shared across workers. Set it to `cosmos` (with
`AZURE_COSMOS_ENDPOINT` and `AZURE_COSMOS_KEY`) for Azure Cosmos DB; see
[docs/storage.md](docs/storage.md). Unconfigured storage returns 503, never mock data.
Speech tokens and extraction need their `AZURE_SPEECH_*` / `AZURE_OPENAI_*` settings and
return 503 `SERVICE_NOT_CONFIGURED` without them; whiteboard and Leaves AI endpoints
return 501 until their owners connect the real services. Browser extraction mocks turn each utterance into a seed;
they are **not AI extraction**. Mock composition joins picked words and never speaks.

## Ownership and branches

The foundation is shared on `feat/shared-foundation`. Person C's current work is on
`feat/forest-ui`. Branch feature work from the same foundation revision.

| Owner | Suggested branch | Files and responsibilities |
| --- | --- | --- |
| A | `feat/transcription-extraction` | `web/src/transcript`, `api/extract`, `api/speech_token` |
| B | `feat/input-controls` | `web/src/input` — mouse, hand, head, calibration, dwell |
| C | `feat/forest-ui` | `web/src/forest` — render, grow, wilt, resize, roots |
| D | `feat/whispering-leaves` | `web/src/leaves`, `api/leaves_*`, `api/whiteboard`, `demo` |
| Agree as a team | `feat/shared-backend` | `api/seeds`, `api/shared`, `api/health_timer` — Cosmos, CRUD, health |

Each feature folder has a README describing its integration points. Shared changes
to `web/src/types.ts`, the API contracts, root app composition, or backend registration
must be coordinated. Do not have multiple people independently rewrite those files.
See `web/src/forest/README.md` for the forest API/input handoff and
`api/health_timer/README.md` for the storage adapter needed by the hourly timer.

## Contracts and project rules

- `web/src/types.ts` is the frontend source of truth; Python mirrors live in
  `api/shared/models.py`. Request/response details are in [docs/api.md](docs/api.md).
- Features subscribe to `inputBus`, never raw MediaPipe output. It supports all seven
  events including `dwell`; each subscription returns an unsubscribe callback.
- Input positions are normalized viewport coordinates. The mouse adapter currently
  supplies point/select; feature buttons publish explicit actions through the bus.
- Seeds retain `sourceId`, `sourceType`, and `timestampSec` for traceability. Updating
  a seed cannot change its identity, meeting partition, or source provenance.
- Camera tracking remains local. Mic audio goes directly to Azure Speech after the
  backend issues a short-lived token. Whiteboard OCR explicitly uploads an image;
  that is a separate operation from camera tracking.
- Whispering Leaves returns editable text for review. Speaking requires explicit
  confirmation and users must always be able to spell arbitrary words.
- Keep secrets in ignored local settings or Azure app settings. `VITE_*` values are
  public browser configuration. Never place a service key there.
- Deployed Functions require authorization. Before deployment, add a trusted gateway
  or application authentication and per-meeting access checks; never ship a Function
  key in the browser. Meeting partitioning alone is not authorization.

## ADP challenge alignment

The supplied challenge asks for meaningful AI, a working full-stack flow, and useful
next steps from scattered business context. Grovekeeper's core demonstration should
be a meeting commitment becoming a traceable, actionable seed. Search, conflict
detection, reports, and nudges remain roadmap work. ADP requests a **5-minute demo**;
the architecture's 3-minute flow can be the core of it. See [demo/README.md](demo/README.md).

## Remaining team decisions

- Assign the shared-backend owner and Azure resource setup.
- The forest currently uses D3 scale/path utilities with accessible HTML controls;
  confirm Azure model/region availability for the other integrations.
- Confirm team size/event duration and complete the actual integrations.
- Define deadline acceleration and how completed seeds affect health before the timer.

Implementation references: [Vite](https://vite.dev/guide/) and
[Azure Functions Python v2](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-python).
