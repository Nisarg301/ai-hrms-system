import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { API_BASE_URL } from '../../services/api';
import type { AuthState } from '../../store/auth/authSlice';
import { activeSubscription } from '../../test/fixtures';
import { makeTestStore } from '../../test/makeTestStore';
import { server } from '../../test/setup';
import type { AiChatMessage, AiModuleInfo } from '../../types/ai';
import type { PlanType } from '../../types/subscription';
import { AiAssistant } from './AiAssistant';

const MODULES: AiModuleInfo[] = [
  {
    key: 'employees',
    title: 'Employees assistant',
    intro: 'Add, find, change or remove employees.',
    starters: [{ label: 'Show all employees', toolCall: { name: 'list_employees', args: {} } }],
  },
];

function auth(planType: PlanType = 'professional'): AuthState {
  return {
    user: {
      id: 'u1',
      name: 'Ann Admin',
      email: 'ann@acme.com',
      role: 'ORG_ADMIN',
      organizationId: 'o1',
      roleId: null,
      mustChangePassword: false,
      permissions: { scope: 'all' },
      subscription: activeSubscription(planType),
    },
    status: 'authenticated',
    bootstrapped: true,
    error: null,
    resetToken: null,
  };
}

const sse = (...events: [string, unknown][]) =>
  new HttpResponse(events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });

const answer = (result: AiChatMessage['result'], action: AiChatMessage['action'] = null): AiChatMessage => ({
  role: 'assistant',
  text: '',
  result,
  action,
  createdAt: '2026-10-16T10:00:00.000Z',
});

const CARD_ACTION = {
  id: 'a1',
  tool: 'create_employee',
  status: 'pending' as const,
  resultText: null,
  card: {
    title: 'New employee',
    tone: 'default' as const,
    rows: [
      { label: 'Name', value: 'Mike Johnson' },
      { label: 'Email', value: 'mike@company.com' },
    ],
    notes: ['A temporary password will be emailed to mike@company.com.'],
    confirmLabel: 'Create employee',
  },
};

let chatBodies: Record<string, unknown>[] = [];
let employeeReloads = 0;

function renderAt(path: string, planType: PlanType = 'professional') {
  chatBodies = [];
  employeeReloads = 0;
  server.use(
    http.get(`${API_BASE_URL}/ai/modules`, () => HttpResponse.json({ success: true, data: MODULES })),
    http.get(`${API_BASE_URL}/ai/conversations`, () => HttpResponse.json({ success: true, data: [] })),
    http.get(`${API_BASE_URL}/employees`, () => {
      employeeReloads += 1;
      return HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } });
    }),
    http.post(`${API_BASE_URL}/ai/chat`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      chatBodies.push(body);
      if (body.toolCall) {
        return sse(
          ['tool', { name: 'list_employees', label: 'Searching employees' }],
          ['message', { message: answer({ text: '**2 employees**.', table: { columns: [{ key: 'name', title: 'Name' }], rows: [{ name: 'Mike Johnson' }, { name: 'Mike Ross' }] } }) }],
          ['done', { conversationId: 'c1' }]
        );
      }
      return sse(['status', { state: 'thinking' }], ['message', { message: answer(null, CARD_ACTION) }], ['done', { conversationId: 'c1' }]);
    }),
    http.post(`${API_BASE_URL}/ai/actions/a1/confirm`, () =>
      HttpResponse.json({
        success: true,
        data: {
          action: { ...CARD_ACTION, status: 'confirmed', resultText: 'Employee created' },
          message: answer({ text: '✅ **Employee created:** Mike Johnson · Engineering · mike@company.com.' }),
          secrets: [{ label: 'Temporary password', value: 'Temp#Secret123' }],
        },
      })
    )
  );
  const store = makeTestStore({ auth: auth(planType) });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <AiAssistant />
      </MemoryRouter>
    </Provider>
  );
}

const openButton = () => screen.findByRole('button', { name: /open the employees assistant/i });

describe('AiAssistant', () => {
  afterEach(() => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  });

  it('only appears on a page that has an assistant', async () => {
    renderAt('/roles');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: /open the employees assistant/i })).not.toBeInTheDocument();
  });

  it('is not offered on the Basic plan, and asks the server nothing', async () => {
    renderAt('/employees', 'basic');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: /open the employees assistant/i })).not.toBeInTheDocument();
  });

  it('runs a starter chip without typing and shows the table', async () => {
    const user = userEvent.setup();
    renderAt('/employees');
    await user.click(await openButton());
    await user.click(await screen.findByRole('button', { name: 'Show all employees' }));
    expect(await screen.findByText('Mike Ross')).toBeInTheDocument();
    expect(chatBodies[0]).toMatchObject({ module: 'employees', toolCall: { name: 'list_employees', label: 'Show all employees' } });
  });

  it('creates only after Confirm, shows the temporary password once, and reloads the table', async () => {
    const user = userEvent.setup();
    renderAt('/employees');
    await user.click(await openButton());
    await user.click(screen.getByRole('textbox', { name: /message the assistant/i }));
    await user.paste('Add Mike Johnson to Engineering, mike@company.com');
    await user.keyboard('{Enter}');

    const card = await screen.findByTestId('ai-confirm-card');
    expect(within(card).getByText('Mike Johnson')).toBeInTheDocument();
    expect(chatBodies[0]).toMatchObject({ message: 'Add Mike Johnson to Engineering, mike@company.com' });

    await user.click(within(card).getByRole('button', { name: 'Create employee' }));
    expect(await screen.findByText('Temp#Secret123')).toBeInTheDocument();
    expect(await within(card).findByText('Done')).toBeInTheDocument();
    await waitFor(() => expect(employeeReloads).toBe(1));
  });

  it('sends what was spoken when the speaker pauses', async () => {
    class FakeRecognition {
      static last: FakeRecognition;
      lang = '';
      interimResults = false;
      continuous = true;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      constructor() {
        FakeRecognition.last = this;
      }
      start() {}
      stop() {
        this.onend?.();
      }
      abort() {
        this.onend?.();
      }
    }
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognition;
    const user = userEvent.setup();
    renderAt('/employees');
    await user.click(await openButton());
    await user.click(screen.getByRole('button', { name: /speak a request/i }));

    const recognition = FakeRecognition.last;
    expect(recognition.lang).toBe('en-IN');
    recognition.onresult?.({ results: [{ isFinal: true, 0: { transcript: 'Delete Mike' } }] });
    recognition.onend?.();

    await waitFor(() => expect(chatBodies[0]).toMatchObject({ module: 'employees', message: 'Delete Mike' }));
  });
});
