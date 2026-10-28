import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { API_BASE_URL } from '../../services/api';
import { activeSubscription } from '../../test/fixtures';
import { makeTestStore } from '../../test/makeTestStore';
import { server } from '../../test/setup';
import type { AiChatMessage, AiModuleInfo } from '../../types/ai';
import { AiAssistant } from './AiAssistant';

const MODULES: AiModuleInfo[] = [
  { key: 'employees', title: 'Employees assistant', intro: 'Find and manage employees.', starters: [] },
  {
    key: 'navigation',
    title: 'Navigation assistant',
    intro: 'Say where you want to go.',
    starters: [{ label: 'Where can I go?', toolCall: { name: 'list_pages', args: {} } }],
  },
];

const answer = (result: AiChatMessage['result']): AiChatMessage => ({ role: 'assistant', text: '', result, action: null, createdAt: '2026-10-28T10:00:00.000Z' });
const OPENING = answer({ text: 'Opening **Projects**.', goTo: '/projects' });
const stream = (message: AiChatMessage) =>
  new HttpResponse(`event: message\ndata: ${JSON.stringify({ message })}\n\nevent: done\ndata: {"conversationId":"c1"}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });

/** Where the page is: a live "Go to" answer moves it. */
function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(path: string, opts: { history?: AiChatMessage[]; reply?: AiChatMessage } = {}) {
  const history = opts.history ?? [];
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.get(`${API_BASE_URL}/ai/modules`, () => HttpResponse.json({ success: true, data: MODULES })),
    http.get(`${API_BASE_URL}/ai/conversations`, () =>
      HttpResponse.json({ success: true, data: history.length ? [{ id: 'c1', module: 'navigation', updatedAt: '2026-10-28T10:00:00.000Z', preview: 'Go to projects' }] : [] })
    ),
    http.get(`${API_BASE_URL}/ai/conversations/c1`, () => HttpResponse.json({ success: true, data: { id: 'c1', module: 'navigation', updatedAt: '2026-10-28T10:00:00.000Z', messages: history } })),
    http.get(`${API_BASE_URL}/employees`, () => HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } })),
    http.post(`${API_BASE_URL}/ai/chat`, async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return stream(opts.reply ?? OPENING);
    })
  );
  const store = makeTestStore({
    auth: {
      user: { id: 'u1', name: 'Ann Admin', email: 'ann@acme.com', role: 'ORG_ADMIN', organizationId: 'o1', roleId: null, mustChangePassword: false, permissions: { scope: 'all' }, subscription: activeSubscription('professional') },
      status: 'authenticated',
      bootstrapped: true,
      error: null,
      resetToken: null,
    },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <AiAssistant />
        <Where />
      </MemoryRouter>
    </Provider>
  );
  return { bodies };
}

const send = async (text: string) => {
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: /message the assistant/i }), `${text}{Enter}`);
};

describe('AiAssistant: going to a page', () => {
  it('offers the Navigation assistant on a page without one of its own', async () => {
    renderAt('/home');
    await userEvent.setup().click(await screen.findByRole('button', { name: /open the navigation assistant/i }));
    expect(await screen.findByRole('button', { name: 'Where can I go?' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /message the assistant/i })).toHaveAttribute('placeholder', 'Type or speak, e.g. Go to projects');
  });

  it('sends the current page, opens the page a live answer names, and closes the drawer', async () => {
    const { bodies } = renderAt('/home?tab=welcome');
    await userEvent.setup().click(await screen.findByRole('button', { name: /open the navigation assistant/i }));
    await send('Go to projects');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/projects'));
    expect(bodies[0]).toMatchObject({ module: 'navigation', message: 'Go to projects', page: '/home?tab=welcome' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /message the assistant/i })).not.toBeInTheDocument());
  });

  it("goes from a page's own assistant too", async () => {
    const { bodies } = renderAt('/employees', { reply: answer({ text: 'Opening **Home**.', goTo: '/home' }) });
    await userEvent.setup().click(await screen.findByRole('button', { name: /open the employees assistant/i }));
    await send('Jump to dashboard');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/home'));
    expect(bodies[0]).toMatchObject({ module: 'employees', page: '/employees' });
    // Home has no assistant of its own: the Navigation assistant takes over.
    expect(await screen.findByRole('button', { name: /open the navigation assistant/i })).toBeInTheDocument();
  });

  it('never moves for an answer loaded from history, nor for a refusal', async () => {
    renderAt('/home', { history: [{ role: 'user', text: 'Go to projects', result: null, action: null, createdAt: '2026-10-28T09:59:00.000Z' }, OPENING], reply: answer({ text: "**Roles** is only for your organization's admin, so I can't open it." }) });
    await userEvent.setup().click(await screen.findByRole('button', { name: /open the navigation assistant/i }));
    expect(await screen.findByText(/Opening/)).toBeInTheDocument();
    await send('Open roles');
    expect(await screen.findByText(/only for your organization's admin/)).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/home');
  });
});
