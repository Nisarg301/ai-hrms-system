import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { API_BASE_URL } from '../../services/api';
import { activeSubscription } from '../../test/fixtures';
import { makeTestStore } from '../../test/makeTestStore';
import { server } from '../../test/setup';
import type { AiAction, AiChatMessage, AiModuleInfo } from '../../types/ai';
import { AiAssistant } from './AiAssistant';

const MODULES: AiModuleInfo[] = [
  {
    key: 'expenses',
    title: 'Expenses assistant',
    intro: 'List and filter claims, export them as CSV, see the spending summary, and manage categories.',
    starters: [
      { label: 'Submitted claims', toolCall: { name: 'list_claims', args: { status: 'submitted' } } },
      { label: 'New category', toolCall: { name: 'create_category', args: {}, form: true } },
    ],
  },
];

// The "New category" chip's card: the page's defaults, the name still missing.
const ACTION: AiAction = {
  id: 'x1',
  tool: 'create_category',
  status: 'pending',
  resultText: null,
  card: {
    title: 'New category',
    tone: 'default',
    rows: [{ label: 'Name', value: '—' }],
    confirmLabel: 'Create category',
    form: { kind: 'category', mode: 'create', values: { name: '', limitRupees: null, receiptAboveRupees: 500, isActive: true } },
    incomplete: true,
  },
};

const answer = (message: Partial<AiChatMessage>): AiChatMessage => ({ role: 'assistant', text: '', result: null, action: null, createdAt: '2026-10-21T10:00:00.000Z', ...message });
const LIST = answer({ result: { text: '**3 claims** · Awaiting approval.', view: '/expenses?status=submitted' } });
const stream = (message: AiChatMessage) =>
  new HttpResponse(`event: message\ndata: ${JSON.stringify({ message })}\n\nevent: done\ndata: {"conversationId":"c1"}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });

/** Where the page is: the assistant moves it for a live answer. */
function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

function renderExpenses(opts: { history?: AiChatMessage[]; reply?: AiChatMessage } = {}) {
  const history = opts.history ?? [];
  const seen = { confirmed: null as unknown, categoryReloads: 0 };
  server.use(
    http.get(`${API_BASE_URL}/ai/modules`, () => HttpResponse.json({ success: true, data: MODULES })),
    http.get(`${API_BASE_URL}/ai/conversations`, () =>
      HttpResponse.json({ success: true, data: history.length ? [{ id: 'c1', module: 'expenses', updatedAt: '2026-10-21T10:00:00.000Z', preview: 'Claims' }] : [] })
    ),
    http.get(`${API_BASE_URL}/ai/conversations/c1`, () => HttpResponse.json({ success: true, data: { id: 'c1', module: 'expenses', updatedAt: '2026-10-21T10:00:00.000Z', messages: history } })),
    http.get(`${API_BASE_URL}/expense-categories`, () => {
      seen.categoryReloads += 1;
      return HttpResponse.json({ success: true, data: [] });
    }),
    http.post(`${API_BASE_URL}/ai/chat`, () => stream(opts.reply ?? LIST)),
    http.post(`${API_BASE_URL}/ai/actions/x1/confirm`, async ({ request }) => {
      seen.confirmed = await request.json();
      return HttpResponse.json({
        success: true,
        data: {
          action: { ...ACTION, status: 'confirmed', resultText: 'Category created' },
          message: answer({ result: { text: '✅ **Category created:** Fuel.', view: '/expenses?tab=categories' } }),
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
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/expenses?tab=categories']}>
        <AiAssistant />
        <Where />
      </MemoryRouter>
    </Provider>
  );
  return seen;
}

describe('AiAssistant on the Expenses page', () => {
  it('moves the page to the tab and filters of a live answer', async () => {
    renderExpenses();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /open the expenses assistant/i }));
    await user.click(await screen.findByRole('button', { name: 'Submitted claims' }));
    expect(await screen.findByText(/3 claims/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/expenses?status=submitted'));
  });

  it('leaves the page alone for an answer loaded from history', async () => {
    renderExpenses({
      history: [
        { role: 'user', text: 'Summary for last month', result: null, action: null, createdAt: '2026-10-21T10:00:00.000Z' },
        answer({ result: { text: '**1 Sep – 30 Sep 2026**: ₹84,500.00 approved.', view: '/expenses?tab=summary&from=2026-09-01&to=2026-09-30' } }),
      ],
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /open the expenses assistant/i }));
    expect(await screen.findByText(/84,500/)).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/expenses?tab=categories');
  });

  it('never moves to another page', async () => {
    renderExpenses({ reply: answer({ result: { text: 'Elsewhere.', view: '/employees' } }) });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /open the expenses assistant/i }));
    await user.click(await screen.findByRole('button', { name: 'Submitted claims' }));
    expect(await screen.findByText('Elsewhere.')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/expenses?tab=categories');
  });

  it('completes a category card, confirms the edited values, and reloads the categories', async () => {
    const seen = renderExpenses({ reply: answer({ action: ACTION }) });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /open the expenses assistant/i }));
    await user.click(await screen.findByRole('button', { name: 'New category' }));
    const card = await screen.findByTestId('ai-confirm-card');

    // Incomplete: Confirm is refused until the category has a name.
    await user.click(within(card).getByRole('button', { name: 'Create category' }));
    expect(await within(card).findByText('Name is required')).toBeInTheDocument();
    expect(seen.confirmed).toBeNull();

    await user.click(within(card).getByLabelText('Name'));
    await user.paste('Fuel');
    await user.click(within(card).getByLabelText('Limit per expense'));
    await user.paste('3000');
    const reloadsBefore = seen.categoryReloads;
    await user.click(within(card).getByRole('button', { name: 'Create category' }));

    await waitFor(() => expect(seen.confirmed).toEqual({ values: { name: 'Fuel', limitRupees: 3000, receiptAboveRupees: 500, isActive: true } }));
    expect(await within(card).findByText('Done')).toBeInTheDocument();
    await waitFor(() => expect(seen.categoryReloads).toBe(reloadsBefore + 1));
  }, 60_000);
});
