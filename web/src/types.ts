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

/** meetingId is the storage partition; imports share one partition per account. */
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
export interface SpeechToken { token: string; region: string }
export interface ExtractRequest { meetingId: string; utterances: Utterance[]; accountId?: string | null }
export interface ExtractSourceRequest { source: Source }
export interface UtteranceList { utterances: Utterance[] }
export interface WhiteboardRequest { meetingId: string; imageBase64: string }
export interface WhiteboardResult { text: string; seeds: Seed[] }
export interface SuggestRequest { meetingId: string; recentText: string }
export interface Suggestions { words: string[]; phrases: string[] }
export interface ComposeRequest { meetingId: string; picked: string[] }
export interface ComposeResult { sentence: string }
/** IDs and source provenance are immutable; meetingId travels in the PATCH query. */
export type SeedPatch = Partial<Pick<Seed,
  'text' | 'owner' | 'deadline' | 'kind' | 'status' | 'health' | 'lastActivity' | 'size'
>>;
export interface ApiErrorBody { error: { code: string; message: string } }
