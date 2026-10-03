# Transcription — Person A

- `speech.ts` — `startLiveTranscriber(api, callbacks)` streams the mic to Azure Speech
  with diarized speaker labels (`Guest-1`, …). It only receives short-lived tokens from
  `api.getSpeechToken()` and refreshes them before expiry. The SDK is loaded lazily.
- `session.ts` — `createTranscriptSession({ api, meetingId })` saves each finalized
  utterance (`api.saveUtterance`, retried with the same ID), then calls `api.extract`
  once ~30 s of new saved transcript exists, on a 30 s wall-clock fallback, or on
  `flush()`. Windows re-send 10 s of extracted context; the server deduplicates and the
  session merges seeds by ID. Unsaved speech is never extracted; failures are surfaced
  in `snapshot().error` and retried, never replaced with mock success.
- `TranscriptPanel.tsx` — start/stop mic, live partials, saved transcript, extracted
  seeds with owner/deadline/timestamp. "Play fixture transcript" feeds
  `../api/fixtures.ts` through the same path for development without a microphone.

Whispering Leaves can route a confirmed sentence through a session with
`session.add({ speaker, text, startSec, via: 'leaves' })` to have it saved and extracted.
