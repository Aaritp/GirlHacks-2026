# Transcription — Person A

Use `api.getSpeechToken()` for short-lived credentials, then stream mic audio directly
to Azure Speech. Never expose the Speech key in browser environment variables.
Save finalized utterances through `api.saveUtterance` and extract roughly every
30 seconds of new transcript through `api.extract`. Deduplicate overlapping windows.
Use `../api/fixtures.ts` for transcript development before connecting Speech.
Own `api/extract` and `api/speech_token` as well as this folder.
