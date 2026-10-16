import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import type { AuditLogRow } from '../../types/auditLog';
import AuditLogsPage from './AuditLogsPage';

const ROWS: AuditLogRow[] = [
  { id: 'a2', actorId: 'u1', actorName: 'Ann Admin', actorRole: 'ORG_ADMIN', action: 'delete', module: 'documents', recordId: 'd1', recordLabel: 'Handbook', ipAddress: null, createdAt: '2026-09-28T10:15:00.000Z' },
  { id: 'a1', actorId: 'u2', actorName: 'Uma User', actorRole: 'ORG_USER', action: 'login', module: null, recordId: null, recordLabel: null, ipAddress: '10.0.0.7', createdAt: '2026-09-28T09:00:00.000Z' },
];

function mockLogs(rows: AuditLogRow[] = ROWS) {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get(`${API_BASE_URL}/audit-logs`, ({ request }) => {
      queries.push(new URL(request.url).searchParams);
      return HttpResponse.json({ success: true, data: rows, meta: { page: 1, limit: 20, total: rows.length } });
    })
  );
  return queries;
}

function renderPage() {
  render(
    <Provider store={makeTestStore()}>
      <AuditLogsPage />
    </Provider>
  );
}

describe('AuditLogsPage', () => {
  it('lists who did what, where and when', async () => {
    mockLogs();
    renderPage();

    const handbookRow = (await screen.findByText('Handbook')).closest('tr')!;
    expect(within(handbookRow).getByText('Ann Admin')).toBeInTheDocument();
    expect(within(handbookRow).getByText('Org Admin')).toBeInTheDocument();
    expect(within(handbookRow).getByText('Deleted')).toBeInTheDocument();
    expect(within(handbookRow).getByText('Documents')).toBeInTheDocument();

    const loginRow = screen.getByText('Uma User').closest('tr')!;
    expect(within(loginRow).getByText('Signed in')).toBeInTheDocument();
    expect(within(loginRow).getByText('Sign-in')).toBeInTheDocument();
    expect(within(loginRow).getByText('10.0.0.7')).toBeInTheDocument();
  });

  it('sends the chosen filters to the API', async () => {
    const queries = mockLogs();
    renderPage();
    await screen.findByText('Handbook');

    await userEvent.click(screen.getByLabelText('Filter by module', { selector: 'input' }));
    await userEvent.click(await screen.findByTitle('Documents'));
    await waitFor(() => expect(queries.at(-1)?.get('module')).toBe('documents'));

    await userEvent.click(screen.getByLabelText('Filter by action', { selector: 'input' }));
    await userEvent.click(await screen.findByTitle('Deleted'));
    await waitFor(() => expect(queries.at(-1)?.get('action')).toBe('delete'));
    expect(queries.at(-1)?.get('module')).toBe('documents');
    expect(queries.at(-1)?.get('page')).toBe('1');
  });

  it('shows an empty state when there is no activity', async () => {
    mockLogs([]);
    renderPage();
    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
  });

  it('shows why the logs could not be loaded', async () => {
    server.use(
      http.get(`${API_BASE_URL}/audit-logs`, () =>
        HttpResponse.json({ success: false, error: { message: 'Module not included in your plan' } }, { status: 403 })
      )
    );
    renderPage();
    expect(await screen.findByText('Module not included in your plan')).toBeInTheDocument();
  });
});
