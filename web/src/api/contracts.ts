import type {
  AskRequest, AskResponse, ComposeRequest, ComposeResult, ExtractRequest, ExtractResult, Grove, Seed, SeedPatch,
  SpeechToken, SuggestRequest, Suggestions, Utterance, UtteranceList, WhiteboardRequest, WhiteboardResult,
} from '../types';

export interface GroveApi {
  getSpeechToken(): Promise<SpeechToken>;
  saveUtterance(utterance: Utterance): Promise<Utterance>;
  /** Seeds and roots found in this window, plus suggested completions of open commitments. */
  extract(request: ExtractRequest): Promise<ExtractResult>;
  /** A meeting's saved transcript, ordered by startSec. Unknown meetings return an empty list. */
  getUtterances(meetingId: string): Promise<UtteranceList>;
  createSeed(seed: Seed): Promise<Seed>;
  updateSeed(meetingId: string, id: string, patch: SeedPatch): Promise<Seed>;
  getGrove(meetingId: string): Promise<Grove>;
  /** Ask the Grove: a cited answer from stored seeds, sources and transcripts. */
  ask(request: AskRequest): Promise<AskResponse>;
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
