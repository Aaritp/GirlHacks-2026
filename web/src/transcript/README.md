# Transcription — Person A

Online meetings only. The user enters their name, clicks **Share meeting tab**, and picks
the Chrome tab running Zoom, Meet or Teams (with "Also share tab audio" on). Requires
desktop Chrome or Edge.

Speaker names: the tab carries only the other participants (calls do not play your own
voice back) and the mic carries the user, so they are transcribed separately. Mic lines are
labelled with the user's name; tab lines get diarized labels (`Guest-1`, …) that the user
can rename in the panel. A rename updates saved utterances (re-saved under the same ID)
and the owners of seeds this session extracted. Guest labels restart every capture session,
so renames never touch other sessions' seeds.

- `capture.ts` — browser support check, user-facing error messages, and
  `acquireMeetingStreams` (tab via `getDisplayMedia`, then echo-cancelled mic via
  `getUserMedia`; anything granted is released on failure). `startPcmPipeline` taps tab
  and mic separately with Web Audio and an AudioWorklet. Nothing plays through the
  speakers, and the user keeps hearing the call (`suppressLocalAudioPlayback: false`).
- `pcm.ts` — converts Float32 audio at the context rate to 16 kHz, 16-bit mono PCM.
- `speech.ts` — `startPushTranscriber` feeds that PCM to Azure Speech through a push
  stream: diarized for the tab, or a plain recognizer with a fixed `speaker` for the mic. Only short-lived tokens from
  `api.getSpeechToken()` reach the browser.
- `online.ts` — `startOnlineCapture` runs one transcriber per channel and ends the session once
  when the user stops sharing, the mic disconnects, Speech cancels, or `stop()` is
  called. Audio captured while the token loads is buffered, not dropped.
- `session.ts` — saves each finalized utterance and calls `api.extract` after ~30 s of new
  saved transcript, on a 30 s fallback, or on `flush()`. `renameSpeaker` applies names.
- `TranscriptPanel.tsx` — share/stop, live partials, saved transcript, extracted
  seeds. Any session end triggers the final extraction. "Play fixture transcript"
  feeds `../api/fixtures.ts` through the same path for development without a call.

Whispering Leaves can route a confirmed sentence through a session with
`session.add({ speaker, text, startSec, via: 'leaves' })` to have it saved and extracted.
