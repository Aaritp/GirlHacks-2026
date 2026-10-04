import { expect, it } from 'vitest';
import { mentionedAccounts } from './context';
import type { Account, Utterance } from '../types';

const account: Account = { id: 'client', name: 'Northwind Logistics', aliases: ['NWL', 'A+B'], contacts: [], industry: '' };
const line = (text: string): Utterance => ({ id: 'u', meetingId: 'm', speaker: 'Alex', text, startSec: 1, via: 'voice' });
it('matches names and aliases case-insensitively with punctuation and real word boundaries', () => {
  for (const text of ['Northwind   Logistics will call.', 'Ask NWL, please.', 'Check A+B.']) {
    expect(mentionedAccounts([account], [line(text)]).map(({ account }) => account.id)).toEqual(['client']);
  }
  for (const text of ['NWLonger', 'AAB', 'prefixNorthwind Logistics']) expect(mentionedAccounts([account], [line(text)])).toEqual([]);
});
it('uses the latest matching finalized line for each account', () => {
  expect(mentionedAccounts([account], [line('NWL'), { ...line('nwl'), id: 'later', startSec: 20 }])[0].line.id).toBe('later');
});
