import type { Account, Citation, Utterance } from '../types';

export function meetingContext(utterances: Utterance[], meetingId?: string | null): Utterance[] {
  const unique = new Map<string, Utterance>();
  for (const line of utterances) {
    if (meetingId && line.meetingId === meetingId) unique.set(line.id, line);
  }
  return [...unique.values()].sort((a, b) => a.startSec - b.startSec).slice(-200);
}

export function mentionedAccounts(accounts: Account[], utterances: Utterance[]) {
  return accounts.flatMap((account) => {
    const patterns = [account.name, ...account.aliases].filter((name) => name.trim().length > 1)
      .map((name) => new RegExp(`(^|[^\\p{L}\\p{N}])${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu'));
    const line = [...utterances].reverse().find((item) => patterns.some((pattern) => pattern.test(item.text)));
    return line ? [{ account, line }] : [];
  }).sort((a, b) => b.line.startSec - a.line.startSec);
}

export function timeLabel(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function citationLabel(citation: Citation) {
  const title = citation.title || citation.sourceType;
  return `${title}${citation.timestampSec != null ? ` · ${timeLabel(citation.timestampSec)}` : ''}`;
}
