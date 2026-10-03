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
