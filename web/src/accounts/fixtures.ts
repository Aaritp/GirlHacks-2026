import type { AccountsData } from './api';
import type { Utterance } from '../types';
import type { AccountSeed, AccountSource, SeedKind, SourceType } from './types';

/**
 * Synthetic sample accounts, labeled as such in the UI. Placeholders until the shared
 * demo accounts land; replace rather than merge. Dates are relative so states stay meaningful.
 */
export function createAccountsDemo(now = Date.now()): AccountsData {
  const day = 86_400_000;
  const at = (offset: number) => new Date(now + offset * day).toISOString();
  const date = (offset: number) => {
    const value = new Date(now + offset * day);
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  };
  // Meeting sources have no text: their transcript is stored as utterances, not on the source.
  const source = (accountId: string, id: string, type: SourceType, title: string, daysAgo: number, text: string | null): AccountSource =>
    ({ id, accountId, meetingId: id, type, title, createdAt: at(-daysAgo), text });
  const seed = (from: AccountSource, id: string, kind: SeedKind, text: string, quote: string,
    owner: string | null, deadline: number | null, status: AccountSeed['status'] = 'sprout'): AccountSeed => ({
    id, accountId: from.accountId, meetingId: from.meetingId, text, owner, kind, status, health: 1,
    deadline: deadline === null ? null : date(deadline), sourceType: from.type, sourceId: from.id,
    timestampSec: null, lastActivity: from.createdAt, size: 1, quote,
  });

  const kickoff = source('acct-northwind', 'src-nw-kickoff', 'meeting', 'Payroll migration kickoff', 9, null);
  const email = source('acct-northwind', 'src-nw-email', 'email', 'Re: sandbox credentials', 5,
    'Hi Alex, the sandbox credentials still have not arrived and our testers are blocked. If this slips past Friday we will miss the pilot window. Dana');
  const slack = source('acct-northwind', 'src-nw-slack', 'slack', '#northwind-rollout', 2,
    'Sam: Checklist went out yesterday.\nDana: Got it, thanks. Can you also confirm the tax table mapping covers Quebec?\nSam: I will confirm by Thursday.');
  const doc = source('acct-northwind', 'src-nw-doc', 'document', 'Statement of work v3', 12,
    'Section 4: The customer requires bilingual pay statements for all Quebec employees. Section 6: Go-live is contingent on a successful parallel run.');
  const call = source('acct-harbor', 'src-hb-call', 'meeting', 'Quarterly review', 6, null);
  const chat = source('acct-harbor', 'src-hb-chat', 'chat', 'Support chat with Priya', 1,
    'Priya: Is the summary coming? Leadership is asking whether we renew.\nJordan: Yes, I will have it to you tomorrow.');

  const said = (meetingId: string, lines: [string, string][]): Utterance[] => lines.map(([speaker, text], index) =>
    ({ id: `${meetingId}-u${index + 1}`, meetingId, speaker, text, startSec: 12 + index * 19, via: 'voice' }));

  return {
    utterances: [
      ...said(kickoff.meetingId, [
        ['Dana', 'We need the cutover finished before the January pay run.'],
        ['Alex', 'I will send the integration checklist this week.'],
        ['Dana', 'Agreed, we go with the phased rollout, hourly staff first.']]),
      ...said(call.meetingId, [
        ['Priya', 'Time-off balances were wrong twice last quarter.'],
        ['Jordan', 'I will send a root-cause summary.'],
        ['Priya', 'We decided to keep weekly syncs until this is stable.']]),
    ],
    accounts: [
      { id: 'acct-northwind', name: 'Northwind Logistics', aliases: ['Northwind', 'NWL'], industry: 'Transportation',
        contacts: [{ name: 'Dana Whitfield', role: 'Payroll director' }] },
      { id: 'acct-harbor', name: 'Harbor Health Partners', aliases: ['Harbor Health'], industry: 'Healthcare',
        contacts: [{ name: 'Priya Raman', role: 'HR operations lead' }] },
      { id: 'acct-juniper', name: 'Juniper Retail Group', aliases: [], industry: 'Retail', contacts: [] },
    ],
    timelines: [
      { accountId: 'acct-northwind', items: [
        { source: kickoff, seeds: [
          seed(kickoff, 'nw-checklist', 'commitment', 'Send the integration checklist', 'I will send the integration checklist this week.', 'Alex', -2, 'bloom'),
          seed(kickoff, 'nw-phased', 'decision', 'Phased rollout, hourly staff first', 'Agreed, we go with the phased rollout, hourly staff first.', null, null),
          seed(kickoff, 'nw-cutover', 'customer_need', 'Cutover finished before the January pay run', 'We need the cutover finished before the January pay run.', null, null),
        ] },
        { source: email, seeds: [
          seed(email, 'nw-sandbox', 'commitment', 'Send sandbox credentials to Northwind testers', 'the sandbox credentials still have not arrived and our testers are blocked', 'Alex', -1),
          seed(email, 'nw-pilot-risk', 'risk', 'Pilot window missed if credentials slip past Friday', 'If this slips past Friday we will miss the pilot window.', null, null),
        ] },
        { source: slack, seeds: [
          seed(slack, 'nw-quebec', 'commitment', 'Confirm the tax table mapping covers Quebec', 'I will confirm by Thursday.', 'Sam', 3),
        ] },
        { source: doc, seeds: [
          seed(doc, 'nw-bilingual', 'customer_need', 'Bilingual pay statements for Quebec employees', 'The customer requires bilingual pay statements for all Quebec employees.', null, null),
        ] },
      ] },
      { accountId: 'acct-harbor', items: [
        { source: call, seeds: [
          seed(call, 'hb-summary', 'commitment', 'Send a root-cause summary of the time-off balance errors', 'I will send a root-cause summary.', 'Jordan', 1),
          seed(call, 'hb-syncs', 'decision', 'Keep weekly syncs until balances are stable', 'We decided to keep weekly syncs until this is stable.', null, null),
        ] },
        { source: chat, seeds: [
          seed(chat, 'hb-renewal', 'risk', 'Renewal in question while the summary is outstanding', 'Leadership is asking whether we renew.', null, null),
        ] },
      ] },
      { accountId: 'acct-juniper', items: [] },
    ],
  };
}
