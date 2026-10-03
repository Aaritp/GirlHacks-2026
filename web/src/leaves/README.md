# Whispering Leaves — Person D

Use `api.suggest({ meetingId, recentText })` and `api.compose({ meetingId, picked })`.
Composition returns a preview only. Never speak until the user explicitly confirms;
editing the draft must invalidate any prior confirmation. Always allow spelling any
word and make head/dwell selection use the same input bus as mouse interaction.
After confirmed speech, save an utterance with `via: 'leaves'` so it gets equal credit.
Own the leaves and whiteboard Python blueprints, plus `demo/`.
