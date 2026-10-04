import type {
  AskRequest, AskResponse, ClearAllRequest, ClearAllResult, ExtractRequest, ExtractResult, Grove, Seed, SeedPatch,
  SpeechToken, Utterance, UtteranceList, WhiteboardRequest, WhiteboardResult,
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
  /** Deletes all stored data (accounts kept by default). The server must opt in. */
  clearAll(request: ClearAllRequest): Promise<ClearAllResult>;
  readWhiteboard(request: WhiteboardRequest): Promise<WhiteboardResult>;
}

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
