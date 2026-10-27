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
    key: 'tasks',
    title: 'Tasks assistant',
    intro: 'Ask about tasks, or create and change them.',
    starters: [{ label: 'New task', toolCall: { name: 'create_task', args: {}, form: true } }],
  },
];

// The server's answer to the "New task" chip: the description is still missing. The member is a
// disabled employee, missing from the people list, so the form shows the card's own name for her.
const ACTION: AiAction = {
  id: 't1',
  tool: 'create_task',
  status: 'pending',
  resultText: null,
  card: {
    title: 'New task',
    tone: 'default',
    rows: [{ label: 'Title', value: 'Fix the login bug' }],
    confirmLabel: 'Create task',
    form: {
      kind: 'task',
      mode: 'create',
      values: { title: 'Fix the login bug', description: '', dueDate: '2026-10-23', status: 'todo', projectId: 'p1', userId: ['u9'] },
      labels: { p1: 'Apollo', u9: 'Old Employee' },
    },
    incomplete: true,
  },
};

const answer = (message: Partial<AiChatMessage>): AiChatMessage => ({ role: 'assistant', text: '', result: null, action: null, createdAt: '2026-10-19T10:00:00.000Z', ...message });

describe('AiAssistant on the Tasks page', () => {
  it('completes an incomplete task card, confirms the edited values, and reloads the table', async () => {
    let confirmed: unknown = null;
    let taskReloads = 0;
    server.use(
      http.get(`${API_BASE_URL}/ai/modules`, () => HttpResponse.json({ success: true, data: MODULES })),
      http.get(`${API_BASE_URL}/ai/conversations`, () => HttpResponse.json({ success: true, data: [] })),
      http.get(`${API_BASE_URL}/projects`, () => HttpResponse.json({ success: true, data: [{ id: 'p1', name: 'Apollo', description: '', deadline: '2026-12-31T00:00:00.000Z', status: 'active' }], meta: { page: 1, limit: 100, total: 1 } })),
      http.get(`${API_BASE_URL}/people`, () =>
        HttpResponse.json({
          success: true,
          data: [{ id: 'u2', name: 'Priya Shah', jobTitle: null, departmentName: null, avatarUrl: null, role: 'ORG_USER', reportsTo: null, joiningDate: '2026-01-05' }],
        })
      ),
      http.get(`${API_BASE_URL}/tasks`, () => {
        taskReloads += 1;
        return HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } });
      }),
      http.post(`${API_BASE_URL}/ai/chat`, () =>
        new HttpResponse(`event: message\ndata: ${JSON.stringify({ message: answer({ action: ACTION }) })}\n\nevent: done\ndata: {"conversationId":"c1"}\n\n`, {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      ),
      http.post(`${API_BASE_URL}/ai/actions/t1/confirm`, async ({ request }) => {
        confirmed = await request.json();
        return HttpResponse.json({
          success: true,
          data: {
            action: { ...ACTION, status: 'confirmed', resultText: 'Task created' },
            message: answer({ result: { text: '✅ **Task created:** Fix the login bug · Apollo · due Fri 23 Oct 2026 · Old Employee.' } }),
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
        <MemoryRouter initialEntries={['/tasks']}>
          <AiAssistant />
        </MemoryRouter>
      </Provider>
    );

    await user.click(await screen.findByRole('button', { name: /open the tasks assistant/i }));
    await user.click(await screen.findByRole('button', { name: 'New task' }));
    const card = await screen.findByTestId('ai-confirm-card');
    // The card's own names show for its project and its member.
    expect(await within(card).findByText('Apollo')).toBeInTheDocument();
    expect(within(card).getByText('Old Employee')).toBeInTheDocument();

    // Incomplete: the form is open, and Confirm is refused until the description is given.
    await user.click(within(card).getByRole('button', { name: 'Create task' }));
    expect(await within(card).findByText('Description is required')).toBeInTheDocument();
    expect(confirmed).toBeNull();

    await user.click(within(card).getByLabelText('Description'));
    await user.paste('Safari users cannot log in');
    await user.click(within(card).getByRole('button', { name: 'Create task' }));

    await waitFor(() =>
      expect(confirmed).toEqual({
        values: { title: 'Fix the login bug', description: 'Safari users cannot log in', dueDate: '2026-10-23', status: 'todo', projectId: 'p1', userId: ['u9'] },
      })
    );
    expect(await within(card).findByText('Done')).toBeInTheDocument();
    await waitFor(() => expect(taskReloads).toBe(1));
  });
});
