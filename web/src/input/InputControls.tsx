import { useEffect, useRef, useState } from 'react';
import { inputBus, type InputBus } from './inputBus';
import { startCamera, type CameraAssets, type CameraMode } from './camera';
import { createHandInput } from './hands';
import { createHeadInput } from './head';
import { domTargetAt } from './targets';
import type { Point } from './tracking';
import type { InputSource } from '../types';

export interface InputControlsProps {
  bus?: InputBus;
  targetAt?: (point: Point) => string | null;
  assets?: CameraAssets;
}

/** Mount once beside the forest. Camera is opt-in; native buttons work without it. */
export function InputControls({ bus = inputBus, targetAt = domTargetAt, assets }: InputControlsProps) {
  const video = useRef<HTMLVideoElement>(null);
  const session = useRef<ReturnType<typeof startCamera> | null>(null);
  const recalibrate = useRef<() => void>(() => {});
  const [mode, setMode] = useState<CameraMode | null>(null);
  const [status, setStatus] = useState('Camera off');
  const [error, setError] = useState('');
  const [calibration, setCalibration] = useState(0);
  const [cursor, setCursor] = useState<Point & { source: InputSource }>({ x: 0.5, y: 0.5, source: 'mouse' });
  const [progress, setProgress] = useState(0);
  const [tracking, setTracking] = useState(false);
  const lastPoint = useRef<Point>({ x: 0.5, y: 0.5 });
  const targetAtRef = useRef(targetAt);
  targetAtRef.current = targetAt;

  useEffect(() => {
    const offPoint = bus.on('point', (event) => { lastPoint.current = { x: event.x, y: event.y }; setCursor(event); });
    const offDwell = bus.on('dwell', (event) => setProgress(event.progress));
    return () => { offPoint(); offDwell(); };
  }, [bus]);

  useEffect(() => {
    if (!mode || !video.current) return;
    let active = true;
    let running = true;
    let mouseUntil = 0;
    const hitTest = (point: Point) => targetAtRef.current(point);
    const hands = createHandInput({ bus, getPosition: () => lastPoint.current });
    const head = createHeadInput({ bus, targetAt: hitTest, onCalibration: (value) => { if (active) setCalibration(value); } });
    const reset = () => { hands.reset(); head.reset(); if (active) setProgress(0); };
    recalibrate.current = () => head.calibrate();
    const offMouse = bus.on('point', (event) => {
      if (event.source === 'mouse') { mouseUntil = performance.now() + 1500; reset(); }
    });
    setError(''); setStatus('Requesting camera and loading tracking…'); setCalibration(0); setTracking(false);
    const camera = startCamera({ video: video.current, mode, assets,
      onFrame(frame, now) {
        if (now < mouseUntil) return;
        setTracking(mode === 'hand' ? frame.hands.length > 0 : frame.face.length > 0);
        if (mode === 'hand') hands.update(frame.hands, now);
        else head.update(frame.face, now);
        if (!running) return; // Dwell may synchronously activate Stop camera.
        setStatus(mode === 'hand' ? (frame.hands.length ? 'Hand tracking active' : 'Show your hand to the camera')
          : !frame.face.length ? 'Face not detected' : head.calibrated ? 'Head tracking active' : 'Look straight ahead and hold still to calibrate');
      },
      onError(reason) { if (active) setError(reason.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access in your browser to try again.' : reason.message); },
      onStop() { running = false; reset(); if (active) { setTracking(false); setMode(null); setStatus('Camera off'); } },
    });
    session.current = camera;
    return () => { active = false; offMouse(); camera.stop(); reset(); session.current = null; recalibrate.current = () => {}; };
  }, [mode, bus, assets]);

  const source = 'mouse' as const; // Native buttons/keyboard share the foundation's mouse source.
  return <section aria-label="Input controls" data-grove-native>
    <h2>Controls</h2>
    <p>Use the mouse or Tab and Enter on buttons. Camera tracking stays in this browser.</p>
    <button type="button" data-grove-target="input-hands" data-grove-input-action
      aria-pressed={mode === 'hand'} onClick={() => setMode('hand')}>Use hands</button>{' '}
    <button type="button" data-grove-target="input-head" data-grove-input-action
      aria-pressed={mode === 'head'} onClick={() => setMode('head')}>Use head</button>{' '}
    <button type="button" data-grove-target="input-stop" data-grove-input-action
      disabled={!mode} onClick={() => session.current?.stop()}>Stop camera</button>{' '}
    <button type="button" data-grove-target="input-calibrate" data-grove-input-action
      disabled={mode !== 'head'} onClick={() => recalibrate.current()}>Recalibrate head</button>
    <p role="status">{status}</p>
    {error && <p role="alert">{error}</p>}
    {mode === 'head' && calibration < 1 && <progress aria-label="Head calibration" max={1} value={calibration} />}
    <p>Start with an open hand. Hold thumb and index finger together to move the cursor; release to park it.
      Touch your middle fingertip to your thumb and release to select. Hold a left-hand thumbs-up to go back.
      Use the buttons below to plant, resize or confirm. Head mode selects when you hold the cursor over a target until the ring fills.</p>
    <div role="group" aria-label="Forest actions">
      <button type="button" data-grove-target="input-plant" data-grove-input-action
        onClick={() => bus.emit({ type: 'plant', ...lastPoint.current, source })}>Plant</button>{' '}
      <button type="button" data-grove-target="input-smaller" data-grove-input-action
        onClick={() => bus.emit({ type: 'resize', scale: 0.9, source })}>Smaller</button>{' '}
      <button type="button" data-grove-target="input-larger" data-grove-input-action
        onClick={() => bus.emit({ type: 'resize', scale: 1.1, source })}>Larger</button>{' '}
      <button type="button" data-grove-target="input-confirm" data-grove-input-action
        onClick={() => bus.emit({ type: 'confirm', source })}>Confirm</button>{' '}
      <button type="button" data-grove-target="input-dismiss" data-grove-input-action
        onClick={() => bus.emit({ type: 'dismiss', source })}>Back</button>
    </div>
    <video ref={video} muted playsInline aria-hidden="true" style={{ position: 'fixed', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
    {mode && tracking && cursor.source !== 'mouse' && <div aria-hidden="true" style={{
      position: 'fixed', left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%`, transform: 'translate(-50%, -50%)',
      pointerEvents: 'none', zIndex: 10000, width: 30, height: 30, borderRadius: '50%', border: '2px solid white',
      background: `conic-gradient(#256c40 ${progress * 360}deg, #b9c9be 0deg)`, boxShadow: '0 0 0 2px #183d25',
    }} />}
    {mode && <progress aria-label="Dwell selection" max={1} value={progress} />}
  </section>;
}
