// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { IngestPanel } from './IngestPanel';
import type { IngestApi } from './contracts';

afterEach(cleanup);
function setup() {
  const api: IngestApi = {
    getAccounts: vi.fn().mockResolvedValue([{ id: 'contoso', name: 'Contoso' }, { id: 'fabrikam', name: 'Fabrikam' }]),
    ingest: vi.fn().mockResolvedValue({ source: { id: 'email-1', meetingId: 'account-1', title: 'Mail', type: 'email', text: 'Send the checklist.' },
      seeds: [{ id: 'seed-1', text: 'Send the checklist.', kind: 'commitment', quote: 'Send the checklist.', owner: 'Alex', deadline: null }], roots: [] }),
    syncSlack: vi.fn().mockResolvedValue({ importedMessages: 0, lastSyncedTs: '1.000001', seeds: [], sources: [] }),
    draftFollowup: vi.fn().mockResolvedValue({ subject: 'Follow-up', body: 'Hello Alex' }),
  };
  const open = vi.fn(); render(<IngestPanel api={api} onOpenGrove={open} />);
  return { api, open };
}
it('imports, displays citations and opens the exact persisted grove partition', async () => {
  const { api, open } = setup();
  await screen.findByRole('option', { name: 'Contoso' });
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Mail' } });
  fireEvent.change(screen.getByLabelText('Conversation text'), { target: { value: 'Send the checklist.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add to grove' }));
  await screen.findByRole('button', { name: 'Open account grove' });
  expect(api.ingest).toHaveBeenCalledWith({ accountId: 'contoso', title: 'Mail', sourceType: 'email', text: 'Send the checklist.' });
  expect(document.querySelector('blockquote')?.textContent).toContain('Send the checklist.');
  fireEvent.click(screen.getByRole('button', { name: 'Open account grove' }));
  expect(open).toHaveBeenCalledWith('account-1', 'Contoso');
  fireEvent.change(screen.getByLabelText('Client account'), { target: { value: 'fabrikam' } });
  expect(screen.queryByRole('button', { name: 'Open account grove' })).toBeNull();
});
it('retains content after an error and offers editable copy-only follow-up', async () => {
  const { api } = setup(); await screen.findByRole('option', { name: 'Contoso' });
  vi.mocked(api.ingest).mockRejectedValueOnce(new Error('AI unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Load sample email' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add to grove' }));
  expect((await screen.findByRole('alert')).textContent).toContain('AI unavailable');
  expect((screen.getByLabelText('Conversation text') as HTMLTextAreaElement).value).toContain('checklist');
  fireEvent.click(screen.getByRole('button', { name: 'Draft follow-up' }));
  await screen.findByLabelText('Email draft');
  fireEvent.change(screen.getByLabelText('Email draft'), { target: { value: 'Edited draft' } });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  fireEvent.click(screen.getByRole('button', { name: 'Copy draft' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('Subject: Follow-up\n\nEdited draft'));
  expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
});
it('blocks oversized pastes before an API request', async () => {
  const { api } = setup(); await screen.findByRole('option', { name: 'Contoso' });
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Mail' } });
  fireEvent.change(screen.getByLabelText('Conversation text'), { target: { value: 'x'.repeat(100001) } });
  expect((screen.getByRole('button', { name: 'Add to grove' }) as HTMLButtonElement).disabled).toBe(true);
  expect(api.ingest).not.toHaveBeenCalled();
});
