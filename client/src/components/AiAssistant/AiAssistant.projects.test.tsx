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
    key: 'projects',
    title: 'Projects assistant',
    intro: 'Ask about projects, or create and change them.',
    starters: [{ label: 'New project', toolCall: { name: 'create_project', args: {}, form: true } }],
  },
];

// The server's answer to the "New project" chip when the description is still missing.
const ACTION: AiAction = {
  id: 'p1',
  tool: 'create_project',
  status: 'pending',
  resultText: null,
  card: {
    title: 'New project',
    tone: 'default',
    rows: [{ label: 'Name', value: 'Apollo' }],
    confirmLabel: 'Create project',
    form: { kind: 'project', mode: 'create', values: { name: 'Apollo', description: '', deadline: '2026-12-31', status: 'planning' } },
    incomplete: true,
  },
};

const answer = (message: Partial<AiChatMessage>): AiChatMessage => ({ role: 'assistant', text: '', result: null, action: null, createdAt: '2026-10-16T10:00:00.000Z', ...message });

describe('AiAssistant on the Projects page', () => {
  it('completes an incomplete project card, confirms the edited values, and reloads the table', async () => {
    let confirmed: unknown = null;
    let projectReloads = 0;
    server.use(
      http.get(`${API_BASE_URL}/ai/modules`, () => HttpResponse.json({ success: true, data: MODULES })),
      http.get(`${API_BASE_URL}/ai/conversations`, () => HttpResponse.json({ success: true, data: [] })),
      http.get(`${API_BASE_URL}/projects`, () => {
        projectReloads += 1;
        return HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } });
      }),
      http.post(`${API_BASE_URL}/ai/chat`, () =>
        new HttpResponse(`event: message\ndata: ${JSON.stringify({ message: answer({ action: ACTION }) })}\n\nevent: done\ndata: {"conversationId":"c1"}\n\n`, {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      ),
      http.post(`${API_BASE_URL}/ai/actions/p1/confirm`, async ({ request }) => {
        confirmed = await request.json();
        return HttpResponse.json({
          success: true,
          data: {
            action: { ...ACTION, status: 'confirmed', resultText: 'Project created' },
            message: answer({ result: { text: '✅ **Project created:** Apollo · due Thu 31 Dec 2026 · Planning.' } }),
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
        <MemoryRouter initialEntries={['/projects']}>
          <AiAssistant />
        </MemoryRouter>
      </Provider>
    );

    await user.click(await screen.findByRole('button', { name: /open the projects assistant/i }));
    await user.click(await screen.findByRole('button', { name: 'New project' }));
    const card = await screen.findByTestId('ai-confirm-card');

    // Incomplete: the form is open, and Confirm is refused until the description is given.
    await user.click(within(card).getByRole('button', { name: 'Create project' }));
    expect(await within(card).findByText('Description is required')).toBeInTheDocument();
    expect(confirmed).toBeNull();

    await user.click(within(card).getByLabelText('Description'));
    await user.paste('Rewrite of the customer mobile app');
    await user.click(within(card).getByRole('button', { name: 'Create project' }));

    await waitFor(() =>
      expect(confirmed).toEqual({ values: { name: 'Apollo', description: 'Rewrite of the customer mobile app', deadline: '2026-12-31', status: 'planning' } })
    );
    expect(await within(card).findByText('Done')).toBeInTheDocument();
    await waitFor(() => expect(projectReloads).toBe(1));
  });
});
