# Leaves service setup

The Leaves/forest flow uses Speech, OpenAI, and the shared repository. Accounts,
the dashboard and online tab capture are integrated from main. Whiteboard OCR
and its Blob/Vision dependencies are removed.

Keep keys in ignored api/local.settings.json under Values, or Function App settings.
Never place service keys in VITE_* variables. See docs/storage.md for Cosmos setup.

| Setting | Used for |
| --- | --- |
| GROVEKEEPER_STORAGE_MODE=cosmos | Shared persistence; memory is explicitly temporary local storage. |
| AZURE_COSMOS_ENDPOINT, AZURE_COSMOS_KEY, optional AZURE_COSMOS_DATABASE | Shared Cosmos adapter. |
| AZURE_SPEECH_KEY, AZURE_SPEECH_REGION | Backend exchange for a short-lived browser Speech token. |
| AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT | Shared structured extraction and context-aware Leaves suggestions. |

Set VITE_USE_MOCKS=false for HTTP. Vite proxies /api to Functions on port 7071.
Deployment still requires trusted application authentication and per-meeting
authorization; do not put Function keys in the browser.

Missing configuration returns explicit 503 errors. Azure failures return 502 or
the shared storage 503. HTTP never silently returns fixtures. Manual spelling
and deterministic composition do not need an AI model.

Suggestions use the shared complete_json helper with minimal reasoning effort.
They read the latest stored 120-second meeting window, bounded to 200 utterances
and 16000 characters, plus optional supplemental text. Compose joins tokens
verbatim, up to 20000 characters.

The app owns one meeting start and one user name. The transcript panel's Your name
field enables Leaves and labels both mic and Leaves contributions. Azure Speech
synthesis prepares a silent buffer. The controller rechecks the draft revision
before playback; only the browser playing event records a stable-ID utterance.
That event establishes playback initiation, not that the full sentence was heard.
Retries save/extract without replaying. Pending saves are panel-local: resolve
them before changing names or reloading.

Desktop Chrome/Edge supports online tab capture. Share the meeting tab with audio;
the microphone carries your own voice separately. Leaves audio plays locally:
routing it to Zoom/Meet/Teams is a separate setup requirement. Stop capture before
the Leaves demo to avoid recording its audio a second time.

Real Azure verification needs configured resources; fake-backed tests do not
establish live cloud connectivity or permission.
