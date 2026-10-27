import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL } from '../../services/api';
import { activeSubscription } from '../../test/fixtures';
import { makeTestStore } from '../../test/makeTestStore';
import { server } from '../../test/setup';
import type { AiChatMessage, AiModuleInfo } from '../../types/ai';
import { AiAssistant } from './AiAssistant';

const MODULES: AiModuleInfo[] = [
  {
    key: 'exports',
    title: 'Exports assistant',
    intro: 'Say which data to download.',
    starters: [{ label: 'Download everything', toolCall: { name: 'export_csv', args: { modules: 'all' } } }],
  },
];

const answer = (result: AiChatMessage['result']): AiChatMessage => ({ role: 'assistant', text: '', result, action: null, createdAt: '2026-10-19T10:00:00.000Z' });

const TWO_FILES = answer({
  text: '**2 CSV files**: Employees and Documents.',
  downloads: [
    { label: 'Employees CSV', path: '/exports/employees' },
    { label: 'Documents CSV', path: '/exports/documents' },
  ],
  autoDownload: true,
});

let requested: string[] = [];
let savedAs: string[] = [];

/** The export endpoint as the page uses it; documents can be made to answer 403. */
function exportsEndpoint(forbidden: string[] = []) {
  return http.get(`${API_BASE_URL}/exports/:module`, ({ params }) => {
    const module = String(params.module);
    requested.push(module);
    if (forbidden.includes(module)) return HttpResponse.json({ success: false, error: { message: 'Forbidden' } }, { status: 403 });
    return new HttpResponse('Name\r\nA\r\n', {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${module}-2026-10-19.csv"` },
    });
  });
}

function renderExports() {
  const store = makeTestStore({
    auth: {
      user: {
        id: 'u1',
        name: 'Ann Admin',
        email: 'ann@acme.com',
        role: 'ORG_ADMIN',
        organizationId: 'o1',
        roleId: null,
        mustChangePassword: false,
        permissions: { scope: 'all' },
        subscription: activeSubscription('professional'),
      },
      status: 'authenticated',
      bootstrapped: true,
      error: null,
      resetToken: null,
    },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/exports']}>
        <AiAssistant />
      </MemoryRouter>
    </Provider>
  );
}

beforeEach(() => {
  requested = [];
  savedAs = [];
  Object.assign(window.URL, { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    savedAs.push(this.download);
  });
});
afterEach(() => vi.restoreAllMocks());

describe('AiAssistant on the Exports page', () => {
  it('downloads the files of a live answer one after another, under the names the server gives', async () => {
    server.use(
      http.get(`${API_BASE_URL}/ai/modules`, () => HttpResponse.json({ success: true, data: MODULES })),
      http.get(`${API_BASE_URL}/ai/conversations`, () => HttpResponse.json({ success: true, data: [] })),
      http.post(`${API_BASE_URL}/ai/chat`, () =>
        new HttpResponse(`event: message\ndata: ${JSON.stringify({ message: TWO_FILES })}\n\nevent: done\ndata: {"conversationId":"c1"}\n\n`, {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      ),
      exportsEndpoint()
    );
    renderExports();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /open the exports assistant/i }));
    const input = screen.getByLabelText('Message the assistant');
    expect(input).toHaveAttribute('placeholder', 'Type or speak, e.g. Download employees and projects');
    await user.click(input);
    await user.paste('Download employees and documents');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(savedAs).toEqual(['employees-2026-10-19.csv', 'documents-2026-10-19.csv']));
    expect(requested).toEqual(['employees', 'documents']);
    expect(screen.getByRole('button', { name: 'Download Employees CSV' })).toBeInTheDocument();
    expect(screen.getByText('If your browser asks whether this site may download multiple files, choose Allow.')).toBeInTheDocument();
  });

  it('downloads nothing from history until a button is clicked, and shows a refused download', async () => {
    server.use(
      http.get(`${API_BASE_URL}/ai/modules`, () => HttpResponse.json({ success: true, data: MODULES })),
      http.get(`${API_BASE_URL}/ai/conversations`, () =>
        HttpResponse.json({ success: true, data: [{ id: 'c1', module: 'exports', updatedAt: '2026-10-19T10:00:00.000Z', preview: 'Download' }] })
      ),
      http.get(`${API_BASE_URL}/ai/conversations/c1`, () =>
        HttpResponse.json({
          success: true,
          data: {
            id: 'c1',
            module: 'exports',
            updatedAt: '2026-10-19T10:00:00.000Z',
            messages: [{ role: 'user', text: 'Download employees and documents', result: null, action: null, createdAt: '2026-10-19T10:00:00.000Z' }, TWO_FILES],
          },
        })
      ),
      exportsEndpoint(['documents'])
    );
    renderExports();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /open the exports assistant/i }));
    const documents = await screen.findByRole('button', { name: 'Download Documents CSV' });
    await new Promise((r) => setTimeout(r, 50));
    expect(requested).toEqual([]);

    await user.click(documents);
    expect(await screen.findByText("You don't have permission to download the Documents CSV.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download Employees CSV' }));
    await waitFor(() => expect(savedAs).toEqual(['employees-2026-10-19.csv']));
    expect(requested).toEqual(['documents', 'employees']);
  });
});
