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
  { key: 'auditLogs', title: 'Audit Logs assistant', intro: 'Load the audit log.', starters: [{ label: 'All audit logs', toolCall: { name: 'list_audit_logs', args: {} } }] },
];

const ANSWER: AiChatMessage = {
  role: 'assistant',
  text: '',
  result: { text: '**2 entries** · Leave · Created.', view: '/audit-logs?module=leave&action=create' },
  action: null,
  createdAt: '2026-10-22T10:00:00.000Z',
};

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

describe('AiAssistant on the Audit Logs page', () => {
  it('loads the entries asked for, and moves the page to the same filters', async () => {
    server.use(
      http.get(`${API_BASE_URL}/ai/modules`, () => HttpResponse.json({ success: true, data: MODULES })),
      http.get(`${API_BASE_URL}/ai/conversations`, () => HttpResponse.json({ success: true, data: [] })),
      http.post(`${API_BASE_URL}/ai/chat`, () =>
        new HttpResponse(`event: message\ndata: ${JSON.stringify({ message: ANSWER })}\n\nevent: done\ndata: {"conversationId":"c1"}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
      )
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
        <MemoryRouter initialEntries={['/audit-logs']}>
          <AiAssistant />
          <Where />
        </MemoryRouter>
      </Provider>
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /open the audit logs assistant/i }));
    await user.click(await screen.findByRole('button', { name: 'All audit logs' }));
    expect(await screen.findByText(/2 entries/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/audit-logs?module=leave&action=create'));
  });
});
