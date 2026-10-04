/** Shared wire contracts. Coordinate changes with the team and api/shared/models.py. */
export type InputSource = 'hand' | 'head' | 'mouse';
export type GroveEvent =
  | { type: 'point'; x: number; y: number; source: InputSource }
  | { type: 'select'; x: number; y: number; source: InputSource }
  | { type: 'dwell'; x: number; y: number; progress: number; source: InputSource }
  | { type: 'plant'; x: number; y: number; source: InputSource }
  | { type: 'resize'; scale: number; source: InputSource }
  | { type: 'confirm'; source: InputSource }
  | { type: 'dismiss'; source: InputSource };

export type SeedKind = 'commitment' | 'decision' | 'risk' | 'customer_need';
export type SourceType = 'meeting' | 'whiteboard' | 'email' | 'chat' | 'document' | 'slack';

export interface Seed {
  id: string;
  meetingId: string;
  text: string;
  owner: string | null;
  deadline: string | null;
  kind: SeedKind;
  status: 'seed' | 'sprout' | 'bloom' | 'wilted';
  health: number;
  sourceType: SourceType | 'leaves';
  sourceId: string;
  timestampSec: number | null;
  lastActivity: string;
  size: number;
  /** Client account this seed belongs to. Absent/null for meetings not linked to an account. */
  accountId?: string | null;
  /** The exact source words this seed was extracted from. Absent/null when none was recorded. */
  quote?: string | null;
  /** Set when a user confirms a suggested completion; null after reopening. */
  completedBy?: CompletedBy | null;
}

/** The source that showed a commitment was finished. */
export interface CompletedBy {
  sourceId: string;
  sourceType: Seed['sourceType'];
  quote: string;
  timestampSec?: number | null;
}

/** An open commitment the transcript says is done. A suggestion only: the user confirms it. */
export interface CompletionSuggestion {
  seedId: string;
  /** The seed's partition, for updateSeed(meetingId, seedId, ...). */
  meetingId: string;
  seedText: string;
  evidenceQuote: string;
  sourceId: string;
  sourceType: Seed['sourceType'];
  timestampSec: number | null;
}

export interface Root {
  id: string;
  meetingId: string;
  fromSeedId: string;
  toSeedId: string;
  type: 'depends_on' | 'related';
}

export interface Utterance {
  id: string;
  meetingId: string;
  speaker: string;
  text: string;
  startSec: number;
  via: 'voice' | 'leaves';
}

/** Non-meeting sources use their own id as meetingId (the storage partition key). */
export interface Source {
  id: string;
  meetingId: string;
  type: SourceType;
  title: string;
  blobUrl?: string | null;
  createdAt: string;
  accountId?: string | null;
  /** Body of an email, chat, document or Slack thread. Null for meetings (stored as utterances). */
  text?: string | null;
}

export interface AccountContact { name: string; role?: string | null; email?: string | null }
export interface Account {
  id: string;
  name: string;
  aliases: string[];
  industry: string;
  contacts: AccountContact[];
}

export interface Grove { seeds: Seed[]; roots: Root[] }
export interface ExtractResult extends Grove { completions?: CompletionSuggestion[] }

/** Ask the Grove. Scope to an account page with accountId; the live assistant adds meetingId + recentUtterances. */
export interface AskRequest {
  question: string;
  accountId?: string | null;
  meetingId?: string | null;
  recentUtterances?: Utterance[];
}
/** Where an answer came from, built from stored records. Meetings jump to timestampSec. */
export interface Citation {
  sourceId: string;
  sourceType: Seed['sourceType'];
  meetingId: string;
  accountId?: string | null;
  seedId?: string | null;
  title?: string | null;
  quote: string;
  timestampSec?: number | null;
}
export interface AskFilters {
  accountIds: string[];
  kinds: SeedKind[];
  status: 'open' | 'done' | 'any';
  dateFrom: string | null;
  dateTo: string | null;
  keywords: string[];
}
/** answered is false (with no citations) when the grove does not contain the answer. */
/** Development reset (POST /maintenance/clear-all). confirm must be exactly "CLEAR ALL". */
export interface ClearAllRequest { confirm: string; keepAccounts?: boolean }
export interface ClearAllResult { deleted: Record<string, number>; keptAccounts: boolean }
export interface AskResponse { answer: string; answered: boolean; citations: Citation[]; filters: AskFilters }
export interface SpeechToken { token: string; region: string }
export interface ExtractRequest { meetingId: string; utterances: Utterance[]; accountId?: string | null }
export interface UtteranceList { utterances: Utterance[] }
export interface WhiteboardRequest { meetingId: string; imageBase64: string }
export interface WhiteboardResult { text: string; seeds: Seed[] }
/** IDs and source provenance are immutable; meetingId travels in the PATCH query. */
export type SeedPatch = Partial<Pick<Seed,
  'text' | 'owner' | 'deadline' | 'kind' | 'status' | 'health' | 'lastActivity' | 'size' | 'completedBy'
>>;
export interface ApiErrorBody { error: { code: string; message: string } }
