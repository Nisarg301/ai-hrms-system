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
    key: 'departments',
    title: 'Departments assistant',
    intro: 'Ask about departments and their employees, or create and change them.',
    starters: [{ label: 'New department', toolCall: { name: 'create_department', args: {}, form: true } }],
  },
];

// The server's answer to the "New department" chip when the description is still missing.
const ACTION: AiAction = {
  id: 'd1',
  tool: 'create_department',
  status: 'pending',
  resultText: null,
  card: {
    title: 'New department',
    tone: 'default',
    rows: [{ label: 'Title', value: 'Design' }],
    confirmLabel: 'Create department',
    form: { kind: 'department', mode: 'create', values: { title: 'Design', description: '', status: 'active' } },
    incomplete: true,
  },
};

const answer = (message: Partial<AiChatMessage>): AiChatMessage => ({ role: 'assistant', text: '', result: null, action: null, createdAt: '2026-10-19T10:00:00.000Z', ...message });

describe('AiAssistant on the Departments page', () => {
  it('completes an incomplete department card, confirms the edited values, and reloads the table', async () => {
    let confirmed: unknown = null;
    let departmentReloads = 0;
    server.use(
      http.get(`${API_BASE_URL}/ai/modules`, () => HttpResponse.json({ success: true, data: MODULES })),
      http.get(`${API_BASE_URL}/ai/conversations`, () => HttpResponse.json({ success: true, data: [] })),
      http.get(`${API_BASE_URL}/departments`, () => {
        departmentReloads += 1;
        return HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } });
      }),
      http.post(`${API_BASE_URL}/ai/chat`, () =>
        new HttpResponse(`event: message\ndata: ${JSON.stringify({ message: answer({ action: ACTION }) })}\n\nevent: done\ndata: {"conversationId":"c1"}\n\n`, {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      ),
      http.post(`${API_BASE_URL}/ai/actions/d1/confirm`, async ({ request }) => {
        confirmed = await request.json();
        return HttpResponse.json({
          success: true,
          data: {
            action: { ...ACTION, status: 'confirmed', resultText: 'Department created' },
            message: answer({ result: { text: '✅ **Department created:** Design · Active.' } }),
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
        <MemoryRouter initialEntries={['/departments']}>
          <AiAssistant />
        </MemoryRouter>
      </Provider>
    );

    await user.click(await screen.findByRole('button', { name: /open the departments assistant/i }));
    await user.click(await screen.findByRole('button', { name: 'New department' }));
    const card = await screen.findByTestId('ai-confirm-card');

    // Incomplete: the form is open, and Confirm is refused until the description is given.
    await user.click(within(card).getByRole('button', { name: 'Create department' }));
    expect(await within(card).findByText('Description is required')).toBeInTheDocument();
    expect(confirmed).toBeNull();

    await user.click(within(card).getByLabelText('Description'));
    await user.paste('Product and brand design');
    await user.click(within(card).getByRole('button', { name: 'Create department' }));

    await waitFor(() => expect(confirmed).toEqual({ values: { title: 'Design', description: 'Product and brand design', status: 'active' } }));
    expect(await within(card).findByText('Done')).toBeInTheDocument();
    await waitFor(() => expect(departmentReloads).toBe(1));
  });
});
