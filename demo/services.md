# Leaves and whiteboard service setup

Revised scope: the active Leaves/forest flow uses Speech, OpenAI, and shared storage.
Vision/Blob settings below apply only to retained, inactive whiteboard backup code.
The active app does not mount OCR or hand/head tracking. Account types/storage,
online shared-tab capture, and Slack/ingestion wait for their owners' integrations.

Keep all keys and connection strings in ignored `api/local.settings.json` under
`Values`, or in Function App settings. No key belongs in a `VITE_*` variable.
Use Person A's `docs/storage.md` for the shared Cosmos adapter.

| Setting | Used for |
| --- | --- |
| `GROVEKEEPER_STORAGE_MODE=cosmos` | Shared persistent repository; `memory` is explicitly local and temporary. |
| `AZURE_COSMOS_ENDPOINT`, `AZURE_COSMOS_KEY`, optional `AZURE_COSMOS_DATABASE` | Person A's four meeting-partitioned containers. |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | Person A's backend token exchange; browser receives a short-lived token only. |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT` | Shared structured extraction plus Leaves suggestions. Choose a deployment supporting structured outputs. |
| `AZURE_VISION_ENDPOINT`, `AZURE_VISION_KEY` | Vision Image Analysis Read (2024-02-01). |
| `AZURE_STORAGE_CONNECTION_STRING` | Server-side private image upload. |
| `AZURE_WHITEBOARD_CONTAINER` (optional, default `whiteboards`) | Existing private container or one the service can create. Public containers are rejected. |

Browser: set `VITE_USE_MOCKS=false` for HTTP. The existing Vite proxy targets
Functions on port 7071. Keep the existing deployment requirement for a trusted
gateway/application authentication and per-meeting authorization; never put a
Function key in the browser.

Missing settings return explicit 503 errors. Azure failures return 502 (or the
shared storage 503). HTTP never returns mock output. Manual spelling/composition
does not need an AI model. Whiteboard requests validate image bytes before services:
PNG/JPEG, at most 10 MiB, 50–16000 pixels per side, at most 40 million pixels.
Raw base64 is required, without a data-URL prefix.

Whiteboards use a SHA-256 image ID and a hashed meeting path in Blob. Source
metadata stores a URL without SAS query parameters. Source is saved before OCR
extraction; a failure can leave the uploaded source/image for a retry. There is
no distributed transaction or orphan cleanup job. Retry with identical bytes to
reuse the image and deduplicate seeds. OCR evidence never enters spoken utterances.

Suggestions use Person A's shared reasoning-model helper (`complete_json`) with
minimal effort; service settings and failure handling stay centralized.

Speech is generated into a buffer with default SDK audio output disabled.
The controller rechecks draft revision after async preparation. Only the browser's
`playing` event creates an utterance; it establishes playback initiation, not
proof that a person heard the complete sentence. An interrupted sentence remains
an initiated contribution. Retry-save does not replay it. Pending saves do not
survive panel unmount/reload; resolve them before changing participants.

API wire shapes remain unchanged. Suggest reads the last 120 seconds relative
to the latest stored utterance (bounded to 200 entries and 16000 characters),
plus optional supplemental text. Compose joins user-selected tokens verbatim,
up to 20000 characters. Extraction accepts an optional server-only whiteboard
Source; ordinary meeting extraction behaves as before.

Implementation references:
[SpeechSynthesizer](https://learn.microsoft.com/javascript/api/microsoft-cognitiveservices-speech-sdk/speechsynthesizer),
[Vision Read API](https://learn.microsoft.com/en-us/azure/ai-services/computer-vision/how-to/call-analyze-image-40).

Real Azure verification requires configured resources; fake-backed tests do not
establish live connectivity or Azure account permissions.
