# Input controls — Person B

Use `inputBus.on(type, listener)` and keep the returned unsubscribe callback for cleanup.
Publish via `inputBus.emit(event)`. Coordinates are normalized **viewport** coordinates
(0–1); resize scale is relative (1 means no change); dwell progress is 0–1.
All seven event shapes live in `../types.ts`.

`attachMouseInput(element)` emits point and select and returns a cleanup callback.
Explicit feature actions publish plant/resize/confirm/dismiss through the same bus.
Do not attach both a feature's direct click handler and a bus select handler to the
same action, or it will run twice. Keep native keyboard access to buttons.

Implement `hands.ts` and `head.ts` here. Camera processing remains in the browser.
Features must never import MediaPipe directly. Tracking calibration, gesture arbitration,
dwell, camera permission UI, and head/hand adapters belong to Person B.

## Implemented controls

`InputSurface` is the integration entry point. It mounts `InputControls`, attaches
the mouse adapter once, and connects all seven events to one `FeatureInputActions`
owner. Head and hand modes are exclusive. Moving the mouse pauses camera input for
1.5 seconds and cancels pending gestures/dwell. Native buttons work with Tab and
Enter/Space; no global keyboard shortcuts intercept text entry.

| Input | Event / behavior |
| --- | --- |
| Hold thumb/index pinch, then move the hand | Relative, mirrored cursor movement from a stable palm anchor; 100 ms engagement debounce |
| Release thumb/index pinch | Park the cursor exactly where it is; no click, drift or automatic hand dwell |
| Touch middle fingertip to thumb for 60–800 ms, then release | One `select` at the parked cursor after 80 ms stable release |
| Left-hand thumbs-up held 650 ms | One `dismiss` event, interpreted by the feature as Back |
| Head movement | Average nose/eye landmarks, compensate translation, scale and roll, then filter into `point` |
| Head cursor held on an actionable target for 1100 ms | `dwell` progress followed by one `select` |
| Plant / Smaller / Larger / Confirm / Back buttons | Same bus commands via mouse, keyboard or tracked selection |

Start with an open hand for 200 ms, then pinch to acquire the cursor. Release and
pinch again to reposition your hand without moving the cursor (like lifting a mouse).
Tap middle finger to thumb with the same controlling hand; allow 200 ms with the
middle finger released before another tap. The cursor freezes as a tap approaches.
Either hand can move/select. Left-hand Back also works while the right hand is
controlling the cursor. Right thumbs-up, fists and open palms no longer execute
commands. Two pinches freeze motion; use Smaller/Larger for explicit resizing.
This supersedes the original fist/confirm/palm and two-hand resize shortcuts.

Poses are geometric heuristics over MediaPipe landmarks, not a trained gesture
classifier. Camera accuracy and thresholds need testing with real users, lighting,
hand sizes and camera angles. A held Back command cannot repeat until neutral.
Pinch and tap use separate enter/exit thresholds. Tracking
loss, malformed landmarks, identity changes and frame gaps cancel pending actions.
The raw camera is unmirrored: handedness labels are swapped at the camera boundary
following [MediaPipe's handedness convention](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/hands.md#multi_handedness).
Verify anatomical left/right with a physical webcam when changing that pipeline.
Back uses the existing `dismiss` contract, not browser history navigation; C supplies
the app's back/cancel action. The isolated preview logs that event.

Head mode first requires 1.5 seconds of steady, forward-facing calibration. Use
Recalibrate after repositioning. Tracking loss cancels dwell but retains calibration.
Calibration uses medians and measures the stationary noise floor. Smoothing adds
a five-frame median, a noise-sized dead zone and adaptive response (220 ms for
small corrections, down to 65 ms for larger motion). Hand motion uses a three-frame
median and a smaller dead zone. Movement sensitivity is lower than the original
head adapter; deliberate motion beyond the dead zone still reaches the screen edges.
After face loss, five valid frames are required before cursor updates resume.
Dwell only operates on targets returned by `targetAt`; blank space never selects.
Movement resets incomplete dwell; completed dwell stays latched until leaving that
target. The cursor ring and progress element show progress and clear on cancellation.

## Person C / app-wiring handoff (integration pending)

At foundation revision `b99fc93`, `web/src/forest` contains only its README. There
are no feature actions to import. `App.tsx`, shared types, API client and backend
have therefore not been rewritten. Connect C's real action handlers when available:

```tsx
import { InputSurface } from '../input/InputSurface';
import { domTargetAt } from '../input/targets';

// forestActions is supplied by Person C, not implemented by the input adapter.
<InputSurface actions={forestActions} onError={showActionError}
  targetAt={(point) => domTargetAt(point) ?? hitTestForestTarget(point)}>
  <Forest />
</InputSurface>
```

`FeatureInputActions` has one typed callback for each GroveEvent type. Map these
callbacks to the SAME actions used by forest buttons. `point` and `dwell` only
update presentation. `select` performs viewport hit-testing/selection. `plant`,
`resize` and `confirm` perform C's existing domain action, which calls the typed
`GroveApi` and A's storage routes. `dismiss` cancels the current UI interaction.
The test handlers' sprout/bloom transitions are fixtures, not a proposed domain rule.

- Mount exactly one `InputSurface` per bus. Do not additionally subscribe the same
  forest actions with `inputBus.on` or `connectInputActions`. The bridge rejects a
  second bridge owner and returns an idempotent cleanup callback.
- Existing native forest buttons may call C's actions directly OR emit bus commands,
  never both. The mouse adapter excludes native controls and keyboard-generated
  clicks so bubbling cannot also select. Non-native action elements must opt out
  with `data-grove-native` and supply their own keyboard support.
- For DOM targets, set a unique `data-grove-target="seed-id"`. A canvas renderer
  supplies its own hit test, returning stable IDs or null for empty/disabled targets.
  Include `domTargetAt` when combining canvas hit testing with the toolbar.
- `InputSurface` handles tracked toolbar selection before forwarding forest
  selection. Manual composition must call `activateInputControl` first for tracked
  select events, or head users cannot activate the toolbar.
- C retains selected seed identity, applies each relative resize once to current
  size, serializes dependent mutations, and handles pending/failed saves. The input
  bridge reports rejected action promises without retrying or duplicating writes.
  Disable unavailable/pending actions in C's action layer for every input source.
- No input adapter imports Cosmos or calls an API. No cursor, dwell, frame or
  landmark persistence exists. Only C's feature actions own durable mutations.

The only changes outside this folder are `web/package.json` and `package-lock.json`
for the pinned `@mediapipe/tasks-vision` dependency. Coordinate these dependency
changes when merging; shared event/API contracts are unchanged.

## Camera lifecycle and assets

Camera access starts only after Use hands / Use head. HTTPS or localhost is required.
Stopping, unmounting, switching modes, hiding the tab or ending a camera track stops
all tracks, closes the detector, cancels animation callbacks and clears video.
Permission/model failures leave mouse and keyboard usable. Late permissions and
late model loads are cleaned up even after the component has unmounted.

MediaPipe is lazy-loaded. Default WASM is pinned to package version 0.10.32 and
models to asset revision 1. Pass stable `assets` with same-origin model/WASM paths
for offline deployments or stricter CSP. Downloads fetch model/code assets only;
video inference and landmarks remain browser-local. Nothing is recorded or uploaded.
Inference currently runs synchronously, capped at 20 fps and only on new frames;
profile on target hardware before deciding whether to move it to a browser worker.
Implementation references: [MediaPipe hand landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js)
and [face landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js).

## Verification

Run `npm run typecheck`, `npm test`, and `npm run build` from the root. Tests cover
event delivery, stable calibration, one-shot dwell and cancellation, gesture
debouncing, pinch/tap/back arbitration, stationary jitter suppression, tracking loss, native control exclusion,
cleanup including late async camera startup, and gesture → injected feature action
→ typed mock API updates. Mock state resets on a fresh instance/browser reload;
these tests do not establish durable storage.

With `npm run dev`, open `/src/input/preview.html` for isolated input diagnostics.
It shows recent command events and an opt-in dwell target. It does not save seeds
and is not wired into the production app. Native button/keyboard and real-camera
browser checks remain pending: the browser automation connection failed in this
workspace before a page could be opened.

An opt-in HTTP contract test can run once A's development API is available:

```powershell
$env:VITE_INPUT_TEST_API_URL = 'http://127.0.0.1:7071/api'
npm test
Remove-Item Env:VITE_INPUT_TEST_API_URL
```

This creates one seed in a unique `input-test-*` meeting, sends three mutations via
injected test action handlers and the typed HTTP client, then checks a fresh client
can read them back with unchanged provenance. It intentionally leaves the test seed
because the API has no delete route. It is skipped unless configured. No API was
listening on port 7071 during implementation, so this check has NOT passed yet.

Real-service acceptance with A and C still required:

1. Mount the wrapper with C's actual actions and use `VITE_USE_MOCKS=false` against
   A's Cosmos-backed routes. Select a real seed; note its ID and meeting partition.
2. Pinch-move to Plant and middle-tap to select it, then use Larger/Smaller and
   confirm via head dwell on the toolbar. Verify C's intended state changes and exactly one mutation per committed
   action. Cursor/dwell frames must produce zero requests.
3. Reload the browser and fetch the same grove. Verify status, size and provenance
   agree with the stored seed. Repeat with mouse/native keyboard actions and verify
   the identical persistence path. Memory-mode reload alone does not prove Cosmos.
4. Test save failure, rapid commands, camera denial/loss, mode changes, tab hiding,
   left/right hands and unmount/remount. Verify errors are visible, no duplicate
   writes occur, and camera indicators turn off on cleanup.
