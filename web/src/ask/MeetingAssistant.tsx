import type { GroveApi } from '../api/contracts';
import type { AccountsApi } from '../accounts/api';
import type { Utterance } from '../types';
import { AskBox } from './AskBox';
import { ContextCards } from './ContextCards';
import { meetingContext } from './context';

export function MeetingAssistant({ api, accountsApi, accountId, meetingId, utterances, mockMode, onVoiceActiveChange }: {
  api: GroveApi; accountsApi: AccountsApi; accountId?: string | null; meetingId: string;
  utterances: Utterance[]; mockMode: boolean;
  onVoiceActiveChange?: (active: boolean) => void;
}) {
  const recent = meetingContext(utterances, meetingId);
  return <aside className="meeting-assistant" aria-label="Live meeting assistant">
    <AskBox api={api} accountsApi={accountsApi} accountId={accountId} meetingId={meetingId}
      recentUtterances={recent} voiceEnabled mockMode={mockMode} onVoiceActiveChange={onVoiceActiveChange} />
    <ContextCards key={`${meetingId}:${accountId ?? ''}`} api={api} accountsApi={accountsApi}
      utterances={recent} mockMode={mockMode} />
  </aside>;
}
