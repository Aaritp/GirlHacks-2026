# Leaves integration handoff

Branch: feat/whispering-leaves. Merged main at b02fb34, including the shared account
backend, account dashboard, online capture, and transcript shared-clock support.

## Shared contracts and app wiring

- Reuse Person A's get_store(), list_utterances and save_utterance, plus existing
  extraction and seed/root persistence. No parallel repository or Cosmos changes.
- Preserve Person C's account routes, forest shell, shared GroveApi and refresh
  callback. Transcript and Leaves use the same meeting and API instance.
- TranscriptPanel.tsx is taken entirely from main. App owns meetingStartedAt,
  userName and meetingClock. Your name is the only identity input, and Leaves
  mounts only for a nonblank name, keyed by meeting/name.
- Edits revoke speech confirmation. Changing the name discards the previous
  participant's draft and confirmation. Only playback initiation saves a
  Leaves utterance; retries retain its ID without replaying speech.
- Native mouse/keyboard controls do not dispatch the forest's global confirm
  event. No tracking adapters are mounted.
- Whiteboard implementation, tests, fixture wrapper, panel, dependencies and
  demo image/generator are removed. api/whiteboard and api/extract/pipeline.py
  match main; the foundation's legacy whiteboard placeholder remains untouched.
- Shared types, models, function registration, storage and account behavior come
  from main. Leaves suggestions remain meeting-scoped.

## Review and remaining integration

The PR targets main for team review; it does not merge itself. The account
dashboard's Ask the Grove slot is separate from this Leaves feature.

Online tab capture is implemented by Person A. Leaves plays through local browser
audio; routing output into the call still needs operator setup. Stop capture
before demonstrating Leaves to avoid recapturing its speech. Pending save retries
are panel-local and should be resolved before changing names or reloading.

The transcript accepts accountId, but the existing App meeting route does not yet
pass it. Account linkage remains a separate team integration; this PR does not
invent cross-account context or change the extraction pipeline. Person B owns
ingestion and Slack.

See validation.md for the final check results and README.md for the five-minute
demo with clearly labeled backups.
