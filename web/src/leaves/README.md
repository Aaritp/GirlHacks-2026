# Whispering Leaves — Person D

Current scope: mouse and keyboard composition for online client meetings.
The hand/head-tracking branch is not part of the revised product.

Mount LeavesPanel with the shared GroveApi instance, meeting ID, identified speaker,
meeting clock, and forest reload callback. Key the panel by meeting/speaker so
unfinished drafts cannot move between participants. The app retains Person C's
ForestWorkspace and passes the same API instance to transcript and Leaves.

- `session.ts` enforces one-use confirmation of the exact preview. Edits, canceled
  preparation, and stale composition responses cannot authorize speech.
- `speech.ts` gets a short-lived token from the existing endpoint. Synthesis is
  silent until explicit playback. Only the browser playing event records a
  stable-ID utterance with `via: 'leaves'`. Save/extraction retries never replay.
- Native mouse clicks and keyboard Enter/Space reach the same controller methods.
  There is no global input-bus confirmation handler or camera/tracking dependency.
- Users can type arbitrary spelling, edit the preview directly, or use the
  on-screen letter/Unicode keys. Suggestions use the shared backend AI helper and
  the selected meeting's persisted recent context.
- The transcript panel's Your name field controls the speaker for both panels.
  Leaves appears only with a nonblank name. Changing it remounts Leaves and clears
  its draft and confirmation. Both panels use the app-owned meeting start time.

The shared account backend/dashboard is integrated. Leaves suggestions remain
scoped to the selected meeting's stored utterances, not account-wide retrieval.
Whiteboard implementation, fixtures, dependencies, and demo assets have been removed.

See `demo/integration.md`, `demo/services.md`, and the revised five-minute runbook.
