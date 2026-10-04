// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('./accounts', () => ({ accountsApi: {}, AccountsApp: () => <div>Account dashboard</div> }));
vi.mock('./ask', () => ({ MeetingAssistant: () => <div>Meeting assistant</div> }));
vi.mock('./forest/ForestWorkspace', () => ({ ForestWorkspace: ({ meetingId, children }: { meetingId: string; children: ReactNode }) =>
  <div><span data-testid="partition">{meetingId}</span>{children}</div> }));
vi.mock('./transcript/TranscriptPanel', () => ({ TranscriptPanel: ({ meetingId, accountId }: { meetingId: string; accountId: string | null }) =>
  <div data-testid="transcript">{meetingId}|{accountId}</div> }));
vi.mock('./ingest/IngestPanel', () => ({ IngestPanel: ({ onOpenGrove }: { onOpenGrove: (id: string, title: string) => void }) =>
  <button onClick={() => onOpenGrove('account-import', 'Imported account')}>Open imported grove</button> }));
import { App } from './App';

afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); });

it('preserves the meeting account when switching to ingestion and back', () => {
  window.history.replaceState({}, '', '/?meetingId=meet-42&accountId=client%20one');
  render(<App />);
  expect(screen.getByTestId('transcript').textContent).toBe('meet-42|client one');
  expect(screen.getByRole('link').getAttribute('href')).toBe('?account=client%20one');
  fireEvent.click(screen.getByRole('button', { name: 'Add to grove' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open imported grove' }));
  expect(screen.getByTestId('partition').textContent).toBe('account-import');
  expect(screen.queryByTestId('transcript')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Return to meeting' }));
  expect(screen.getByTestId('transcript').textContent).toBe('meet-42|client one');
});

it.each(['?accounts', '?account=client-one'])('preserves dashboard routing for %s', (query) => {
  window.history.replaceState({}, '', '/' + query);
  render(<App />);
  expect(screen.getByText('Account dashboard')).toBeTruthy();
  expect(screen.queryByTestId('transcript')).toBeNull();
});
