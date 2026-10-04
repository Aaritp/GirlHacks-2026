import type { Seed, Source, Root } from '../types';

export type { Account } from '../types';
import type { Account } from '../types';
export type IngestSourceType = 'email' | 'chat' | 'document' | 'slack';
export interface Message { author: string; recipients?: string[]; timestamp?: string | null; text: string; rawText?: string | null; externalId?: string }
export interface IngestRequest {
  accountId: string; sourceType: IngestSourceType; title: string;
  text?: string; messages?: Message[]; filename?: string; fileBase64?: string;
  /** When it happened (ISO datetime with offset); defaults to now. Never in the future. */
  occurredAt?: string;
}
export interface IngestResult { source: Source & { messages?: Message[] }; seeds: Seed[]; roots: Root[] }
export interface SlackResult { importedMessages: number; lastSyncedTs: string; seeds: Seed[]; sources: Source[] }
export interface Followup { subject: string; body: string }
export interface IngestApi {
  getAccounts(): Promise<Account[]>;
  ingest(request: IngestRequest): Promise<IngestResult>;
  syncSlack(request: { accountId: string; channelId: string }): Promise<SlackResult>;
  draftFollowup(accountId: string): Promise<Followup>;
}
export const MAX_TEXT = 100000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
