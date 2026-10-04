/**
 * PROVISIONAL account shapes, local to the dashboard until the shared foundation lands.
 * When Account, accountId, the new seed kinds and source types are in `../types`, delete
 * these and import the shared ones. Nothing outside `web/src/accounts` should import this file.
 */
import type { Seed } from '../types';

export type SeedKind = 'commitment' | 'decision' | 'risk' | 'customer_need';
export type SourceType = 'meeting' | 'whiteboard' | 'email' | 'chat' | 'document' | 'slack';

export interface AccountContact { name: string; role?: string; email?: string }

export interface Account {
  id: string;
  name: string;
  aliases: string[];
  industry: string;
  contacts: AccountContact[];
}

export interface AccountSeed extends Omit<Seed, 'kind' | 'sourceType'> {
  accountId: string;
  kind: SeedKind;
  sourceType: SourceType | 'leaves';
  /** The words in the source this seed was extracted from. Null when none was recorded. */
  quote: string | null;
}

export interface AccountSource {
  id: string;
  accountId: string;
  meetingId: string;
  type: SourceType;
  title: string;
  createdAt: string;
  /** Full text of the conversation or document. Null when the body is not stored. */
  text: string | null;
}

export interface TimelineItem { source: AccountSource; seeds: AccountSeed[] }
/** Proposed response of GET /api/accounts/{id}/timeline: every source, newest first. */
export interface AccountTimeline { accountId: string; items: TimelineItem[] }
