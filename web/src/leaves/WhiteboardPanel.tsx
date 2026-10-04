import { useEffect, useRef, useState } from 'react';
import type { GroveApi } from '../api/contracts';
import type { Seed, WhiteboardResult } from '../types';

export function WhiteboardPanel({ api, meetingId, onSeeds, mockMode = false }: {
  api: GroveApi; meetingId: string; onSeeds?: (seeds: Seed[]) => void; mockMode?: boolean;
}) {
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<WhiteboardResult>();
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, [meetingId]);
  async function upload() {
    if (!file || busy) return;
    const ticket = ++generation.current;
    setBusy(true); setError(''); setResult(undefined);
    try {
      if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 10 * 1024 * 1024) {
        throw new Error('Choose a PNG or JPEG image up to 10 MiB.');
      }
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read this image.'));
        reader.readAsDataURL(file);
      });
      const next = await api.readWhiteboard({ meetingId, imageBase64: encoded });
      if (ticket === generation.current) { setResult(next); onSeeds?.(next.seeds); }
    } catch (reason) {
      if (ticket === generation.current) setError(reason instanceof Error ? reason.message : 'Upload failed.');
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  return <section className="whiteboard" aria-labelledby="whiteboard-heading">
    <h3 id="whiteboard-heading">Bring in a whiteboard</h3>
    <p>Upload explicitly to store the image privately, read its text, and save traceable seeds.</p>
    {mockMode && <p>Whiteboard fixtures are backup material, not Azure OCR.</p>}
    <label>Whiteboard image (PNG or JPEG, up to 10 MiB)
      <input type="file" accept="image/png,image/jpeg" disabled={busy}
        onChange={(e) => { setFile(e.target.files?.[0]); setResult(undefined); setError(''); }} />
    </label>
    <button type="button" disabled={!file || busy} onClick={() => void upload()}>
      {busy ? 'Reading and saving…' : 'Upload image and save extracted seeds'}
    </button>
    {error && <p role="alert">{error} Retrying the same image will reuse its source.</p>}
    {result && <div aria-live="polite">
      <h4>Read from the board</h4><pre>{result.text || 'No text detected.'}</pre>
      <h4>{result.seeds.length} saved seeds</h4>
      <ul>{result.seeds.map((seed) => <li key={seed.id}>{seed.text} — {seed.owner ?? 'Owner not stated'}
        <br /><small>Whiteboard source: {seed.sourceId}</small></li>)}</ul>
    </div>}
  </section>;
}
