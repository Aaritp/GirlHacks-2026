import type { Grove, Seed, Utterance } from '../types';
import { ApiError, type GroveApi } from './contracts';
import { demoGrove, demoSuggestions } from './fixtures';

/** Per-instance, in-memory state. No AI, audio, OCR, or external requests. */
export function createMockApi(initial: Grove = demoGrove): GroveApi {
  const seeds = new Map<string, Seed>();
  const utterances = new Map<string, Utterance>();
  const roots = structuredClone(initial.roots);
  const key = (meetingId: string, id: string) => JSON.stringify([meetingId, id]);
  for (const seed of initial.seeds) seeds.set(key(seed.meetingId, seed.id), structuredClone(seed));
  const grove = (meetingId: string): Grove => structuredClone({
    seeds: [...seeds.values()].filter((seed) => seed.meetingId === meetingId),
    roots: roots.filter((root) => root.meetingId === meetingId),
  });
  return {
    async getSpeechToken() {
      throw new ApiError(501, 'NOT_IMPLEMENTED', 'Speech needs a real Azure token; mocks cannot transcribe audio.');
    },
    async saveUtterance(utterance) {
      utterances.set(key(utterance.meetingId, utterance.id), structuredClone(utterance));
      return structuredClone(utterance);
    },
    async extract({ meetingId, utterances: input, accountId = null }) {
      if (input.length < 1 || input.length > 200) {
        throw new ApiError(400, 'INVALID_REQUEST', 'Provide between 1 and 200 utterances.');
      }
      if (input.some((item) => item.meetingId !== meetingId)) {
        throw new ApiError(400, 'INVALID_REQUEST', 'All utterances must belong to the requested meeting.');
      }
      // Deterministic development behavior: one seed per supplied utterance, no inferred promises.
      for (const item of input) {
        const id = `mock-${item.id}`;
        if (!seeds.has(key(meetingId, id))) {
          seeds.set(key(meetingId, id), {
            id, meetingId, text: item.text, owner: item.speaker || null, deadline: null,
            kind: 'commitment', status: 'seed', health: 1,
            sourceType: item.via === 'leaves' ? 'leaves' : 'meeting', sourceId: meetingId,
            timestampSec: item.startSec, lastActivity: new Date().toISOString(), size: 1,
            accountId, quote: item.text,
          });
        }
      }
      const ids = new Set(input.map((item) => `mock-${item.id}`));
      return { seeds: grove(meetingId).seeds.filter((seed) => ids.has(seed.id)), roots: [] };
    },
    async extractSource() {
      throw new ApiError(501, 'NOT_IMPLEMENTED', 'Text extraction needs Azure OpenAI; mocks do not invent seeds from text.');
    },
    async getUtterances(meetingId) {
      return structuredClone({
        utterances: [...utterances.values()].filter((item) => item.meetingId === meetingId)
          .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id)),
      });
    },
    async createSeed(seed) {
      const identity = key(seed.meetingId, seed.id);
      if (seeds.has(identity)) throw new ApiError(409, 'CONFLICT', 'Seed already exists.');
      seeds.set(identity, structuredClone(seed));
      return structuredClone(seed);
    },
    async updateSeed(meetingId, id, patch) {
      const identity = key(meetingId, id);
      const current = seeds.get(identity);
      if (!current) throw new ApiError(404, 'NOT_FOUND', 'Seed not found.');
      // Mirror the wire contract even if a caller bypasses TypeScript.
      const allowed = new Set(['text', 'owner', 'deadline', 'kind', 'status', 'health', 'lastActivity', 'size']);
      if (!Object.keys(patch).length || Object.entries(patch).some(([field, value]) =>
        value === null && field !== 'owner' && field !== 'deadline')) {
        throw new ApiError(400, 'INVALID_REQUEST', 'Provide a non-empty patch; only owner and deadline may be null.');
      }
      if (Object.keys(patch).some((field) => !allowed.has(field))) {
        throw new ApiError(400, 'INVALID_REQUEST', 'Cannot change seed identity or source provenance.');
      }
      if ((patch.health !== undefined && (!Number.isFinite(patch.health) || patch.health < 0 || patch.health > 1))
        || (patch.size !== undefined && (!Number.isFinite(patch.size) || patch.size <= 0))) {
        throw new ApiError(400, 'INVALID_REQUEST', 'Health must be 0–1 and size must be positive.');
      }
      const updated = { ...current, ...structuredClone(patch) };
      seeds.set(identity, updated);
      return structuredClone(updated);
    },
    async getGrove(meetingId) { return grove(meetingId); },
    async readWhiteboard() {
      throw new ApiError(501, 'NOT_IMPLEMENTED', 'Whiteboard OCR has not been connected.');
    },
    async suggest() { return structuredClone(demoSuggestions); },
    async compose({ picked }) {
      if (!picked.length || picked.length > 200 || picked.some((word) => !word.trim())) {
        throw new ApiError(400, 'INVALID_REQUEST', 'Pick or spell at least one non-empty word.');
      }
      // Return a preview only. Never invoke speech from this API.
      return { sentence: picked.join(' ') };
    },
  };
}
