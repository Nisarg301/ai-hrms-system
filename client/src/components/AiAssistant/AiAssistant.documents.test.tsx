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

// In jsdom a request whose FormData holds a File never completes (msw can't read it), so the
// confirm request is stubbed here; ai.endpoints.confirm.test.ts checks the multipart body it builds,
// and the server's route test sends a real one.
vi.mock('../../services/endpoints/ai.endpoints', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/endpoints/ai.endpoints')>()),
  confirmAiActionRequest: vi.fn(),
}));

const MODULES: AiModuleInfo[] = [
  {
    key: 'documents',
    title: 'Documents assistant',
    intro: 'Ask about documents, or upload and change them.',
    starters: [{ label: 'Upload a document', toolCall: { name: 'create_document', args: {} } }],
  },
];

// The server's card once the title, description and category are known: the file comes last.
const ACTION: AiAction = {
  id: 'd1',
  tool: 'create_document',
  status: 'pending',
  resultText: null,
  card: {
    title: 'Upload a document',
    tone: 'default',
    rows: [
      { label: 'Title', value: 'Employee handbook' },
      { label: 'Category', value: 'HR' },
    ],
    confirmLabel: 'Upload document',
    form: { kind: 'document', mode: 'create', values: { title: 'Employee handbook', description: 'The rules', category: 'HR', status: 'active' }, categories: ['HR'] },
    file: { required: true },
  },
};

const answer = (message: Partial<AiChatMessage>): AiChatMessage => ({ role: 'assistant', text: '', result: null, action: null, createdAt: '2026-10-19T10:00:00.000Z', ...message });

let documentReloads = 0;
let pickerOpens = 0;

function renderDocuments(history: AiChatMessage[] = []) {
  server.use(
    http.get(`${API_BASE_URL}/ai/modules`, () => HttpResponse.json({ success: true, data: MODULES })),
    http.get(`${API_BASE_URL}/ai/conversations`, () =>
      HttpResponse.json({ success: true, data: history.length ? [{ id: 'c1', module: 'documents', updatedAt: '2026-10-19T10:00:00.000Z', preview: 'Upload' }] : [] })
    ),
    http.get(`${API_BASE_URL}/ai/conversations/c1`, () => HttpResponse.json({ success: true, data: { id: 'c1', module: 'documents', updatedAt: '2026-10-19T10:00:00.000Z', messages: history } })),
    http.get(`${API_BASE_URL}/documents`, () => {
      documentReloads += 1;
      return HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } });
    }),
    http.post(`${API_BASE_URL}/ai/chat`, () =>
      new HttpResponse(`event: message\ndata: ${JSON.stringify({ message: answer({ action: ACTION }) })}\n\nevent: done\ndata: {"conversationId":"c1"}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    ),
  );
  vi.mocked(confirmAiActionRequest).mockResolvedValue({
    data: {
      action: { ...ACTION, status: 'confirmed', resultText: 'Document uploaded' },
      message: answer({ result: { text: '✅ **Document uploaded:** Employee handbook · HR · handbook.pdf (8 B).' } }),
      secrets: [],
    },
    headers: {},
  } as never);
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
      <MemoryRouter initialEntries={['/documents']}>
        <AiAssistant />
      </MemoryRouter>
    </Provider>
  );
}

beforeEach(() => {
  documentReloads = 0;
  pickerOpens = 0;
  // Counts the file picker opening; jsdom has no picker to show.
  const click = HTMLInputElement.prototype.click;
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
    if (this.type === 'file') pickerOpens += 1;
    else click.call(this);
  });
});
afterEach(() => vi.restoreAllMocks());

describe('AiAssistant on the Documents page', () => {
  it('asks for the file last, refuses a wrong type, and sends the chosen file with the Confirm click', async () => {
    renderDocuments();
    // Files the input's `accept` would hide in a real picker still reach it here, to test the card's own check.
    const user = userEvent.setup({ applyAccept: false });
    await user.click(await screen.findByRole('button', { name: /open the documents assistant/i }));
    await user.click(await screen.findByRole('button', { name: 'Upload a document' }));
    const card = await screen.findByTestId('ai-confirm-card');

    // A live card opens the picker by itself; Upload waits for a file.
    expect(pickerOpens).toBe(1);
    const upload = within(card).getByRole('button', { name: 'Upload document' });
    expect(upload).toBeDisabled();

    const input = within(card).getByLabelText('File to upload');
    await user.upload(input, new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    expect(within(card).getByText('Choose a PDF, Word, JPEG or PNG file.')).toBeInTheDocument();
    expect(upload).toBeDisabled();

    await user.upload(input, new File(['%PDF-1.4'], 'handbook.pdf', { type: 'application/pdf' }));
    expect(within(card).getByText('handbook.pdf (8 B)')).toBeInTheDocument();
    expect(upload).toBeEnabled();
    await user.click(upload);

    // No edits, so no values: the card's own call goes with the file.
    await waitFor(() => expect(confirmAiActionRequest).toHaveBeenCalledWith('d1', undefined, expect.any(File)));
    expect((vi.mocked(confirmAiActionRequest).mock.calls[0][2] as File).name).toBe('handbook.pdf');
    expect(await within(card).findByText('Done')).toBeInTheDocument();
    await waitFor(() => expect(documentReloads).toBe(1));
  });

  it('never opens the picker for a card loaded from history', async () => {
    renderDocuments([{ role: 'user', text: 'Upload a document', result: null, action: null, createdAt: '2026-10-19T10:00:00.000Z' }, answer({ action: ACTION })]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /open the documents assistant/i }));
    expect(await screen.findByTestId('ai-file-field')).toBeInTheDocument();
    expect(pickerOpens).toBe(0);
    // Choose file still opens it.
    await user.click(screen.getByRole('button', { name: /Choose file/ }));
    expect(pickerOpens).toBe(1);
  });
});
