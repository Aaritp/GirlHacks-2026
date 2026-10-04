# Local validation

Branch: `feat/whispering-leaves`, based on main dbaba29 (Person A's backend
and Person C's forest). These checks were recorded before branch publication;
Git history records the current publication state.

- Node 24.21.0: TypeScript check and production Vite build pass.
- 47 frontend tests pass, covering the forest plus draft-only behavior,
  custom/Unicode spelling, exact-preview confirmation, edit invalidation, stale
  async responses, real native keyboard/mouse activation, canceled credentials,
  playback initiation, autoplay rejection, and stable persistence retries.
  App integration tests verify Leaves seeds appear in the existing forest, that
  confirmation does not alter forest decisions, that meeting selection is shared,
  and that the legacy microphone and OCR controls are absent.
- Python 3.11.9: 116 backend tests pass, including Person A/C tests, the shared
  AI-helper integration, and Leaves/backup-OCR cases against memory/Cosmos fakes.
  Deployment targets the repository's documented Python 3.12; that runtime was
  not installed on this machine.
- The generated fictional whiteboard PNG was visually inspected.

Not performed: live Azure smoke test, deployment, or recording a demo video.
Hand/head tracking is outside the revised scope. Account contracts, tab-audio
capture and Slack/ingestion are still external team dependencies. The five-minute
script and labeled backup plan are ready in `README.md`; do the real-service
preflight before presenting.

Shared modifications are listed in `integration.md`. The Cosmos adapter and
repository interface remain unchanged.
