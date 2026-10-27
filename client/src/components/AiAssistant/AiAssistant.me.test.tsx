import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL } from '../../services/api';
import { confirmAiActionRequest } from '../../services/endpoints/ai.endpoints';
import { activeSubscription } from '../../test/fixtures';
import { makeTestStore } from '../../test/makeTestStore';
import { server } from '../../test/setup';
import type { AiAction, AiChatMessage, AiModuleInfo } from '../../types/ai';
import { AiAssistant } from './AiAssistant';

// A request whose FormData holds a File never completes under msw in jsdom, so confirm is stubbed
// (as in AiAssistant.documents.test.tsx); ai.endpoints.confirm.test.ts checks the multipart body.
vi.mock('../../services/endpoints/ai.endpoints', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/endpoints/ai.endpoints')>()),
  confirmAiActionRequest: vi.fn(),
}));

const MODULES: AiModuleInfo[] = [
  { key: 'leave', title: 'Leave assistant', intro: 'Apply for leave.', starters: [] },
  { key: 'attendance', title: 'Attendance assistant', intro: 'Work from home and fixes.', starters: [] },
  { key: 'my-expenses', title: 'Expenses assistant', intro: 'Your claims.', starters: [{ label: 'New claim', toolCall: { name: 'create_claim', args: {} } }] },
];

// A new claim's card: ₹400 in Other, under its ₹500 receipt limit, so the receipt is optional.
const ACTION: AiAction = {
  id: 'm1',
  tool: 'create_claim',
  status: 'pending',
  resultText: null,
  card: {
    title: 'New claim',
    tone: 'default',
    rows: [
      { label: 'Claim', value: 'Stationery' },
      { label: 'Amount', value: '₹400.00' },
    ],
    confirmLabel: 'Submit claim',
    form: {
      kind: 'claim',
      mode: 'create',
      values: { title: 'Stationery', date: '2026-10-20', categoryId: 'c9', amountRupees: 400, merchant: 'Staples', note: '', submitNow: true },
      categories: [{ id: 'c9', name: 'Other', limitPaise: null, receiptRequiredAbovePaise: 50000 }],
    },
    file: { required: false, kind: 'receipt' },
  },
};

const answer = (message: Partial<AiChatMessage>): AiChatMessage => ({ role: 'assistant', text: '', result: null, action: null, createdAt: '2026-10-22T10:00:00.000Z', ...message });

function renderAt(path: string) {
  server.use(
    http.get(`${API_BASE_URL}/ai/modules`, () => HttpResponse.json({ success: true, data: MODULES })),
    http.get(`${API_BASE_URL}/ai/conversations`, () => HttpResponse.json({ success: true, data: [] })),
    http.get(`${API_BASE_URL}/expenses/mine`, () => HttpResponse.json({ success: true, data: [] })),
    http.post(`${API_BASE_URL}/ai/chat`, () =>
      new HttpResponse(`event: message\ndata: ${JSON.stringify({ message: answer({ action: ACTION }) })}\n\nevent: done\ndata: {"conversationId":"c1"}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    )
  );
  vi.mocked(confirmAiActionRequest).mockResolvedValue({
    data: { action: { ...ACTION, status: 'confirmed', resultText: 'Claim submitted' }, message: answer({ result: { text: '✅ **Claim submitted:** Stationery.' } }), secrets: [] },
    headers: {},
  } as never);
  const store = makeTestStore({
    auth: {
      user: {
        id: 'u2',
        name: 'Priya Shah',
        email: 'priya@acme.com',
        role: 'ORG_USER',
        organizationId: 'o1',
        roleId: 'r1',
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
      <MemoryRouter initialEntries={[path]}>
        <AiAssistant />
      </MemoryRouter>
    </Provider>
  );
}

beforeEach(() => {
  // jsdom has no file picker to show.
  const click = HTMLInputElement.prototype.click;
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
    if (this.type !== 'file') click.call(this);
  });
});
afterEach(() => vi.restoreAllMocks());

describe('AiAssistant on the Me page', () => {
  it.each([
    ['/me/leave', 'leave'],
    ['/me/attendance', 'attendance'],
    ['/me/expenses', 'expenses'],
  ])('is on %s', async (path, name) => {
    renderAt(path);
    expect(await screen.findByRole('button', { name: new RegExp(`open the ${name} assistant`, 'i') })).toBeInTheDocument();
  });

  it.each(['/me/performance', '/me/profile', '/me/team', '/me/holidays'])('is not on %s', async (path) => {
    renderAt(path);
    // The module list never loads for a page without an assistant.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: /assistant/i })).not.toBeInTheDocument();
  });

  it('turns the receipt required as the amount goes over the limit, and sends the edited values with the file', async () => {
    renderAt('/me/expenses');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /open the expenses assistant/i }));
    await user.click(await screen.findByRole('button', { name: 'New claim' }));
    const card = await screen.findByTestId('ai-confirm-card');

    // Under the limit: optional, and Submit claim works without a file.
    expect(within(card).getByRole('button', { name: /Choose receipt \(optional\)/ })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Submit claim' })).toBeEnabled();

    await user.click(within(card).getByRole('button', { name: /Edit/ }));
    const amount = within(card).getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, '850');
    expect(within(card).getByText('Other needs a receipt above ₹500.00.')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /^upload Choose receipt$/ })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Submit claim' })).toBeDisabled();

    // Submit now off: the button says so.
    await user.click(within(card).getByLabelText('Submit now'));
    expect(within(card).getByRole('button', { name: 'Save as draft' })).toBeDisabled();

    await user.upload(within(card).getByLabelText('Receipt to upload'), new File(['%PDF-1.4'], 'staples.pdf', { type: 'application/pdf' }));
    await user.click(within(card).getByRole('button', { name: 'Save as draft' }));
    await waitFor(() =>
      expect(confirmAiActionRequest).toHaveBeenCalledWith(
        'm1',
        { title: 'Stationery', date: '2026-10-20', categoryId: 'c9', amountRupees: 850, merchant: 'Staples', note: '', submitNow: false },
        expect.any(File)
      )
    );
    expect(await within(card).findByText('Done')).toBeInTheDocument();
  }, 60_000);
});
