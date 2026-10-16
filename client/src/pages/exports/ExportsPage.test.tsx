import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import { activeSubscription } from '../../test/fixtures';
import type { AuthState } from '../../store/auth/authSlice';
import type { EffectivePermissions } from '../../types/auth';
import ExportsPage from './ExportsPage';

function renderPage(permissions: EffectivePermissions) {
  const auth: AuthState = {
    user: { id: 'u1', name: 'U', email: 'u@x.com', role: 'ORG_USER', organizationId: 'o1', roleId: 'r1', mustChangePassword: false, permissions, subscription: activeSubscription('professional') },
    status: 'authenticated',
    bootstrapped: true,
    error: null,
    resetToken: null,
  };
  render(
    <Provider store={makeTestStore({ auth })}>
      <ExportsPage />
    </Provider>
  );
}

const READ = { read: true, create: false, update: false, delete: false };
let savedAs: string[] = [];

beforeEach(() => {
  savedAs = [];
  Object.assign(window.URL, { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    savedAs.push(this.download);
  });
});
afterEach(() => vi.restoreAllMocks());

describe('ExportsPage', () => {
  it('offers only the modules the user can read', () => {
    renderPage({ scope: 'matrix', entries: [{ module: 'exports', ...READ }, { module: 'documents', ...READ }, { module: 'tasks', ...READ }] });
    expect(screen.getByTestId('export-documents')).toBeInTheDocument();
    expect(screen.getByTestId('export-tasks')).toBeInTheDocument();
    expect(screen.queryByTestId('export-employees')).not.toBeInTheDocument();
    expect(screen.queryByTestId('export-projects')).not.toBeInTheDocument();
  });

  it('downloads the CSV under the filename the server gives', async () => {
    let requested = '';
    server.use(
      http.get(`${API_BASE_URL}/exports/:module`, ({ params }) => {
        requested = String(params.module);
        return new HttpResponse('Title\r\nHandbook\r\n', {
          headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="documents-2026-09-28.csv"' },
        });
      })
    );
    renderPage({ scope: 'all' });

    await userEvent.click(screen.getByRole('button', { name: 'Download Documents CSV' }));

    await waitFor(() => expect(savedAs).toEqual(['documents-2026-09-28.csv']));
    expect(requested).toBe('documents');
  });

  it('explains a permission error', async () => {
    server.use(http.get(`${API_BASE_URL}/exports/:module`, () => HttpResponse.json({ success: false, error: { message: 'Forbidden' } }, { status: 403 })));
    renderPage({ scope: 'all' });

    await userEvent.click(screen.getByRole('button', { name: 'Download Employees CSV' }));

    expect(await screen.findByText("You don't have permission to export employees.")).toBeInTheDocument();
    expect(savedAs).toEqual([]);
  });

  it('shows an empty state when nothing is exportable', () => {
    renderPage({ scope: 'matrix', entries: [{ module: 'exports', ...READ }] });
    expect(screen.getByText('Nothing to export')).toBeInTheDocument();
  });
});
