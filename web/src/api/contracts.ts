import type {
  ComposeRequest, ComposeResult, ExtractRequest, ExtractSourceRequest, Grove, Seed, SeedPatch,
  SpeechToken, SuggestRequest, Suggestions, Utterance, UtteranceList, WhiteboardRequest, WhiteboardResult,
} from '../types';

export interface GroveApi {
  getSpeechToken(): Promise<SpeechToken>;
  saveUtterance(utterance: Utterance): Promise<Utterance>;
  extract(request: ExtractRequest): Promise<Grove>;
  /** Saves an email/chat/document/Slack Source and extracts seeds from its text. */
  extractSource(request: ExtractSourceRequest): Promise<Grove>;
  /** A meeting's saved transcript, ordered by startSec. Unknown meetings return an empty list. */
  getUtterances(meetingId: string): Promise<UtteranceList>;
  createSeed(seed: Seed): Promise<Seed>;
  updateSeed(meetingId: string, id: string, patch: SeedPatch): Promise<Seed>;
  getGrove(meetingId: string): Promise<Grove>;
  readWhiteboard(request: WhiteboardRequest): Promise<WhiteboardResult>;
  suggest(request: SuggestRequest): Promise<Suggestions>;
  compose(request: ComposeRequest): Promise<ComposeResult>;
}

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
