import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { API_BASE_URL } from '../../services/api';
import { activeSubscription } from '../../test/fixtures';
import { makeTestStore } from '../../test/makeTestStore';
import { server } from '../../test/setup';
import type { AiAction, AiChatMessage, AiModuleInfo } from '../../types/ai';
import { AiAssistant } from './AiAssistant';

const MODULES: AiModuleInfo[] = [
  {
    key: 'roles',
    title: 'Roles assistant',
    intro: 'List roles, or create, change and delete them with their permissions.',
    starters: [{ label: 'New role', toolCall: { name: 'create_role', args: {}, form: true } }],
  },
];

// The server's answer to the "New role" chip: an empty form, so the name is still missing.
const ACTION: AiAction = {
  id: 'r1',
  tool: 'create_role',
  status: 'pending',
  resultText: null,
  card: {
    title: 'New role',
    tone: 'default',
    rows: [
      { label: 'Name', value: '—' },
      { label: 'Permissions', value: 'None' },
    ],
    confirmLabel: 'Create role',
    form: { kind: 'role', mode: 'create', values: { name: '', permissions: [{ module: 'projects', read: true, create: false, update: false, delete: false }] } },
    incomplete: true,
  },
};

const answer = (message: Partial<AiChatMessage>): AiChatMessage => ({ role: 'assistant', text: '', result: null, action: null, createdAt: '2026-10-19T10:00:00.000Z', ...message });

describe('AiAssistant on the Roles page', () => {
  it("completes a role card's name and permission matrix, confirms the edited values, and reloads the table", async () => {
    let confirmed: unknown = null;
    let roleReloads = 0;
    server.use(
      http.get(`${API_BASE_URL}/ai/modules`, () => HttpResponse.json({ success: true, data: MODULES })),
      http.get(`${API_BASE_URL}/ai/conversations`, () => HttpResponse.json({ success: true, data: [] })),
      http.get(`${API_BASE_URL}/roles`, () => {
        roleReloads += 1;
        return HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } });
      }),
      http.post(`${API_BASE_URL}/ai/chat`, () =>
        new HttpResponse(`event: message\ndata: ${JSON.stringify({ message: answer({ action: ACTION }) })}\n\nevent: done\ndata: {"conversationId":"c1"}\n\n`, {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      ),
      http.post(`${API_BASE_URL}/ai/actions/r1/confirm`, async ({ request }) => {
        confirmed = await request.json();
        return HttpResponse.json({
          success: true,
          data: {
            action: { ...ACTION, status: 'confirmed', resultText: 'Role created' },
            message: answer({ result: { text: '✅ **Role created:** Auditor · Employees: Read · Tasks: all.' } }),
            secrets: [],
          },
        });
      })
    );
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
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/roles']}>
          <AiAssistant />
        </MemoryRouter>
      </Provider>
    );

    await user.click(await screen.findByRole('button', { name: /open the roles assistant/i }));
    await user.click(await screen.findByRole('button', { name: 'New role' }));
    const card = await screen.findByTestId('ai-confirm-card');

    // Incomplete: the form is open, and Confirm is refused until the role has a name.
    await user.click(within(card).getByRole('button', { name: 'Create role' }));
    expect(await within(card).findByText('Role name is required')).toBeInTheDocument();
    expect(confirmed).toBeNull();

    await user.click(within(card).getByLabelText('Role name'));
    await user.paste('Auditor');
    // The page's matrix: Read gates the rest, Select All fills a row.
    expect(within(card).getByLabelText('employees create')).toBeDisabled();
    await user.click(within(card).getByLabelText('employees read'));
    await user.click(within(card).getByLabelText('tasks select all'));
    await user.click(within(card).getByLabelText('projects read'));
    await user.click(within(card).getByRole('button', { name: 'Create role' }));

    await waitFor(() =>
      expect(confirmed).toEqual({
        values: {
          name: 'Auditor',
          permissions: [
            { module: 'employees', read: true, create: false, update: false, delete: false },
            { module: 'tasks', read: true, create: true, update: true, delete: true },
          ],
        },
      })
    );
    expect(await within(card).findByText('Done')).toBeInTheDocument();
    await waitFor(() => expect(roleReloads).toBe(1));
    // The matrix's 48 checkboxes make this the slowest card to render in jsdom (20–25 s).
  }, 60_000);
});
