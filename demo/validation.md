# Local validation

Branch: `feat/whispering-leaves`, merged with main b02fb34 (accounts backend,
account dashboard, online capture, and the transcript shared clock).

- Node 24.21.0: TypeScript check and production Vite build pass.
- `npm test`: 115 frontend tests pass across 15 files, covering the forest plus draft-only behavior,
  custom/Unicode spelling, exact-preview confirmation, edit invalidation, stale
  async responses, real native keyboard/mouse activation, canceled credentials,
  playback initiation, autoplay rejection, and stable persistence retries.
  App integration tests verify Leaves seeds appear in the existing forest, that
  confirmation does not alter forest decisions, that meeting selection is shared,
  and that transcript capture and Leaves share one name and clock. Changing the
  shared name clears the prior participant's draft and confirmation.
- `python -m pytest api/tests`: Python 3.11.9, 130 backend tests pass, including
  accounts, transcript storage, extraction and Leaves against memory/Cosmos fakes.
  Deployment targets the repository's documented Python 3.12; that runtime was
  not installed on this machine.
- `npm run typecheck` and `npm run build` both pass on Node 24.21.0.
- TranscriptPanel.tsx and api/extract/pipeline.py match main. Whiteboard
  implementation, panel, tests, dependencies and demo assets are removed;
  the shared foundation's legacy route/types remain unchanged.

Not performed: live Azure smoke test, deployment, or recording a demo video.
Hand/head tracking is outside the revised scope. Accounts and online capture are
integrated; meeting-to-account app wiring and ingestion remain team work. The five-minute
script and labeled backup plan are ready in `README.md`; do the real-service
preflight before presenting.

Shared modifications are listed in `integration.md`. The Cosmos adapter and
repository interface remain unchanged.
