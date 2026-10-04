# Leaves integration handoff — revised team plan

Branch: `feat/whispering-leaves`, fast-forwarded to `main` dbaba29
(Person C's merged forest, plus Person A's latest backend). The previous local
Leaves files were backed up under workspace `.tooling/pre-pivot-*` before merging.
The integration itself created no merge commit. Feature publication is a separate
step; merging the published branch into main remains a team decision.

## Shared contracts and app wiring

- Reuse Person A's `get_store()`, `list_utterances`, `save_utterance`, and
  source/seed/root methods. No repository interface or Cosmos implementation was
  added. Suggestions now use the new `shared.openai_client.complete_json` with
  minimal reasoning effort and structured output.
- Preserve Person C's ForestWorkspace as the app shell, URL meeting selection,
  forest fixture data, and refreshSignal. Transcript and Leaves receive exactly
  the same GroveApi instance and meeting ID. Leaves saves trigger forest refresh.
- Keep the optional shared meeting clock in TranscriptPanel. Add
  `allowMicrophone=false` at the app boundary to hide the old in-person capture
  until Person A's online tab capture lands. The component retains its existing
  implementation for its owner; the app makes the pending integration explicit.
- Speech currently plays through the browser's local audio output. Routing that
  output into an online call is a separate integration requirement; it does not
  automatically become the Zoom/Meet/Teams participant's microphone stream.
- Leaves uses native buttons and inputs for mouse/keyboard. It emits no global
  confirm event, so confirming a preview cannot mark a forest seed as a decision.
  Its old head/dwell adapter is removed. No input-controls branch was merged.
- WhiteboardPanel and the demo OCR wrapper are no longer mounted. OCR API/source,
  fixture image, and tests remain inactive backup material. The optional
  `source: Source | None` extension to extract_and_save remains for that backup:
  OCR evidence never becomes a spoken utterance, and seeds keep image provenance.
- Shared overlap resolution: README and API docs merged from both sides;
  main's dependency files already contain Leaves' jsdom dependency; App combines
  the forest shell with Leaves. `types.ts`, `models.py`, and `function_app.py`
  have no local contract changes and preserve main.

## Owner dependencies and merge order

1. Person A / Prisha: already merged.
2. Person C / forest: already merged in dbaba29.
3. Person D / Leaves: this feature branch is ready for publication and team review.
4. Person B: create ingestion + Slack work from main. Do not merge input-controls.
5. Shared owner: add client accounts to types/storage after the feature merges.

Do not add parallel account fields or fake account-wide retrieval now. Leaves still
reads the selected meeting's persisted context until the account-aware repository
contract is published. Online meetings use shared Zoom/Meet/Teams tabs; Slack is
the only live content connector. Email/chat/docs use paste or upload.

No teammate messages or remote status updates were sent. The screenshot's to-do
link was not provided, so no external checklist was edited.
