# Forest — Person C

`ForestWorkspace` is the forest entry point. Pass `api: GroveApi`, `meetingId`,
`meetingTitle`, and `demo` (only true for synthetic data). `App.tsx` mounts this view and
passes other owners' panels as `children`, shown below the grove (currently the
transcript panel). Changing `refreshSignal` reloads the grove after another feature
saves seeds. Coordinate changes to that shared file.

The renderer uses D3 scale/path utilities and semantic HTML buttons, keeping every
plant keyboard accessible. Garden/list views, search, growth filters, source details,
dependency roots, manual planting, editable owner/deadline/text, progress check-ins,
completion/reopening, decision marking, and size changes are implemented.

The grove uses a transparent botanical atlas with four growth states. Selecting a
plant reveals Tend and Complete actions; plants crossfade after a successful API
write. The inspector keeps owner/deadline visible and puts editing behind a native
disclosure. Reduced-motion preferences remove animation.

On desktop, Arrange enables pointer dragging or Alt + arrow keys on a focused plant.
Reset restores the default arrangement. Positions are per-meeting device preferences
in localStorage, never shared seed data or health activity. Filtering preserves plant
positions. On mobile the garden uses two columns; selecting stays in the grove and
the selected plant's details shortcut moves focus to the inspector.

## Storage

`useGrove` calls the shared `GroveApi`; no Cosmos credentials or competing repository
are introduced. It fetches on mount and every 30 seconds, and updates the displayed
seed only after the write succeeds. Errors remain visible and failed edits can be
retried. Requests from a previous meeting cannot replace the current meeting's data.

Development displays six clearly labeled synthetic seeds. This in-memory demo resets
on reload. For real storage set `VITE_USE_MOCKS=false`, run the API (memory or Cosmos mode, see
`docs/storage.md`), and open
`/?meetingId=YOUR_MEETING_ID`. The forest does not fall back to mocks after API errors.
Production authorization/gateway configuration remains owned by the shared backend.

## Input handoff to Person B

- `select`: normalized viewport coordinates select a plant or activate a native button.
- `plant`: opens the manual seed form when the point is inside this workspace.
- `resize`: applies a relative scale to the selected plant, clamped to 0.75–1.5.
- `confirm`: marks the selected seed as a decision, distinct from completing a task.
- `dismiss`: closes the inspector/form; `dwell`: paints progress at the cursor.
- Native controls call these same feature actions. Do not attach a second click-to-
  action adapter to them. Scope input events to the active feature when integrating
  other views; coordinate who owns global confirm/dismiss dispatch.

## Health

Health is recomputed for display from lastActivity. Seven days without progress
reduces it to zero; below 0.3 displays needs care. Bloom means completed and stays
healthy. Record progress restores health and sets sprout. Resizing/metadata edits
do not count as activity. Deadline acceleration remains off pending team agreement.

Backend health calculations and the hourly timer factory are in `api/health_timer`.
The timer is not registered: it needs a cross-meeting scan and a conditional health
write that the shared store does not offer yet (see `api/health_timer/README.md`).
