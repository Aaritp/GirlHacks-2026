import type { GroveApi } from '../api/contracts';
import { ApiError } from '../api/contracts';

/** Explicit backup fixture. Uses the same mock grove for saved whiteboard seeds.
 * Never pretends to run OCR or emit audio. Real HTTP never calls this wrapper.
 */
export function withLeavesDemoFixtures(api: GroveApi): GroveApi {
  return {
    ...api,
    async readWhiteboard({ meetingId, imageBase64 }) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(imageBase64));
      const id = 'mock-whiteboard-' + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      const seed = {
        id, meetingId, text: 'Send the payroll checklist', owner: 'Alex', deadline: null,
        kind: 'commitment' as const, status: 'seed' as const, health: 1, sourceType: 'whiteboard' as const,
        sourceId: id, timestampSec: null, lastActivity: new Date().toISOString(), size: 1,
      };
      try { await api.createSeed(seed); } catch (reason) {
        if (!(reason instanceof ApiError) || reason.status !== 409) throw reason;
      }
      const saved = (await api.getGrove(meetingId)).seeds.find((item) => item.id === id)!;
      return { text: '[MOCK OCR FIXTURE] Alex will send the payroll checklist.', seeds: [saved] };
    },
  };
}
