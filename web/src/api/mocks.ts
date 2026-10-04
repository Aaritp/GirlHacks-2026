import type { CompletionSuggestion, Grove, Seed, Utterance } from '../types';
import { ApiError, type GroveApi } from './contracts';
import { demoGrove } from './fixtures';

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
      // Deterministic development behavior (not AI): a line saying something is done/sent/finished
      // suggests completing an open commitment that shares at least two significant words with it.
      const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
      const open = [...seeds.values()].filter((seed) => seed.kind === 'commitment' && seed.status !== 'bloom'
        && (accountId ? seed.accountId === accountId : seed.meetingId === meetingId));
      const completions: CompletionSuggestion[] = [];
      for (const item of input) {
        if (!/\b(done|finished|completed?|sent|delivered)\b/i.test(item.text)) continue;
        const said = words(item.text);
        const match = open.find((seed) => !completions.some((c) => c.seedId === seed.id)
          && [...words(seed.text)].filter((word) => said.has(word)).length >= 2);
        if (match) {
          completions.push({ seedId: match.id, meetingId: match.meetingId, seedText: match.text,
            evidenceQuote: item.text, sourceId: meetingId, sourceType: item.via === 'leaves' ? 'leaves' : 'meeting',
            timestampSec: item.startSec });
        }
      }
      // One seed per supplied utterance, no inferred promises.
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
      return { seeds: grove(meetingId).seeds.filter((seed) => ids.has(seed.id)), roots: [], completions };
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
      const allowed = new Set(['text', 'owner', 'deadline', 'kind', 'status', 'health', 'lastActivity', 'size', 'completedBy']);
      if (!Object.keys(patch).length || Object.entries(patch).some(([field, value]) =>
        value === null && field !== 'owner' && field !== 'deadline' && field !== 'completedBy')) {
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
    async clearAll({ confirm, keepAccounts = true }) {
      if (confirm !== 'CLEAR ALL') throw new ApiError(400, 'INVALID_REQUEST', 'Type CLEAR ALL exactly to confirm.');
      const deleted = { seeds: seeds.size, roots: roots.length, utterances: utterances.size };
      seeds.clear();
      roots.length = 0;
      utterances.clear();
      return { deleted, keptAccounts: keepAccounts };
    },
    async ask({ question, accountId = null, meetingId = null }) {
      if (!question.trim()) throw new ApiError(400, 'INVALID_REQUEST', 'Ask a question.');
      // Development behavior (not AI): seeds sharing a significant word with the question.
      const terms = new Set(question.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
      const matches = [...seeds.values()].filter((seed) => (!accountId || seed.accountId === accountId)
        && (!meetingId || accountId || seed.meetingId === meetingId)
        && (`${seed.text} ${seed.quote ?? ''}`.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).some((word) => terms.has(word)));
      const filters = { accountIds: accountId ? [accountId] : [], kinds: [], status: 'any' as const,
        dateFrom: null, dateTo: null, keywords: [...terms] };
      if (!matches.length) return { answer: "I don't have that in the grove.", answered: false, citations: [], filters };
      return {
        answer: `Mock answer (not AI): ${matches.length} matching seed(s): ${matches.map((seed) => seed.text).join('; ')}.`,
        answered: true, filters,
        citations: matches.map((seed) => ({ sourceId: seed.sourceId, sourceType: seed.sourceType, meetingId: seed.meetingId,
          accountId: seed.accountId ?? null, seedId: seed.id, title: null, quote: seed.quote ?? seed.text,
          timestampSec: seed.timestampSec })),
      };
    },
    async readWhiteboard() {
      throw new ApiError(501, 'NOT_IMPLEMENTED', 'Whiteboard OCR has not been connected.');
    },
  };
}
