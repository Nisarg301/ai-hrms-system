import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { documentsReducer } from '../../store/documents/documentsSlice';
import type { DocumentRow } from '../../types/document';
import { createDocumentRequest } from '../../services/endpoints/documents.endpoints';
import { DocumentFormModal } from './DocumentFormModal';

// The form sends multipart FormData. Under jsdom, MSW can't read a jsdom FormData
// body (it arrives as "[object FormData]"), so capture what the component hands
// to the endpoint instead. The spy still calls through, so MSW answers as usual.
vi.mock('../../services/endpoints/documents.endpoints', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/endpoints/documents.endpoints')>();
  return { ...actual, createDocumentRequest: vi.fn(actual.createDocumentRequest) };
});

function sentFormData(): FormData {
  const calls = vi.mocked(createDocumentRequest).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0][0];
}

beforeEach(() => {
  vi.mocked(createDocumentRequest).mockClear();
});

function renderModal(record: DocumentRow | null) {
  const store = configureStore({ reducer: { documents: documentsReducer } });
  const onClose = vi.fn();
  render(
    <Provider store={store}>
      <DocumentFormModal open record={record} onClose={onClose} />
    </Provider>
  );
  return { store, onClose };
}

function mockList() {
  server.use(
    http.get(`${API_BASE_URL}/documents`, () => HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } }))
  );
}

function mockCreated() {
  server.use(
    http.post(`${API_BASE_URL}/documents`, () =>
      HttpResponse.json(
        { success: true, data: { id: 'd1', title: 'Handbook', description: 'Employee handbook', category: 'HR', status: 'active', file: null } },
        { status: 201 }
      )
    )
  );
}

describe('DocumentFormModal', () => {
  it('creates a document with the entered values', async () => {
    mockList();
    mockCreated();
    const { onClose } = renderModal(null);

    await userEvent.type(screen.getByLabelText(/title/i), 'Handbook');
    await userEvent.type(screen.getByLabelText(/description/i), 'Employee handbook');
    await userEvent.type(screen.getByLabelText(/category/i), 'HR');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const form = sentFormData();
    expect(form.get('title')).toBe('Handbook');
    expect(form.get('description')).toBe('Employee handbook');
    expect(form.get('category')).toBe('HR');
    expect(form.get('status')).toBe('active');
    expect(form.get('file')).toBeNull();
  });

  it('sends an attached file along with the fields', async () => {
    mockList();
    mockCreated();
    const { onClose } = renderModal(null);

    await userEvent.type(screen.getByLabelText(/title/i), 'Handbook');
    await userEvent.type(screen.getByLabelText(/description/i), 'Employee handbook');
    await userEvent.type(screen.getByLabelText(/category/i), 'HR');
    const file = new File(['%PDF-1.4'], 'handbook.pdf', { type: 'application/pdf' });
    await userEvent.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
    expect(await screen.findByText('handbook.pdf')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const sent = sentFormData().get('file');
    expect(sent).toBeInstanceOf(File);
    expect((sent as File).name).toBe('handbook.pdf');
  });

  it('requires the mandatory fields', async () => {
    mockList();
    renderModal(null);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
  });

  it('surfaces a server-side field error on the field, not just the banner', async () => {
    mockList();
    let called = false;
    server.use(
      http.post(`${API_BASE_URL}/documents`, () => {
        called = true;
        return HttpResponse.json(
          { success: false, error: { message: 'Validation failed', details: { fieldErrors: { title: ['That title is not allowed'] } } } },
          { status: 400 }
        );
      })
    );
    renderModal(null);

    // Every field is filled validly so client-side Zod passes and the request
    // genuinely reaches the mock — the message can only come from the server.
    await userEvent.type(screen.getByLabelText(/title/i), 'Handbook');
    await userEvent.type(screen.getByLabelText(/description/i), 'Employee handbook');
    await userEvent.type(screen.getByLabelText(/category/i), 'HR');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText('That title is not allowed')).toBeInTheDocument();
    expect(called).toBe(true);
  });

  it('edits an existing document with PUT', async () => {
    mockList();
    let method = '';
    server.use(
      http.put(`${API_BASE_URL}/documents/d1`, async ({ request }) => {
        method = request.method;
        return HttpResponse.json({ success: true, data: { id: 'd1', title: 'Handbook v2', description: 'Employee handbook', category: 'HR', status: 'active' } });
      })
    );
    renderModal({ id: 'd1', title: 'Handbook', description: 'Employee handbook', category: 'HR', status: 'active', file: null });

    await userEvent.clear(screen.getByLabelText(/title/i));
    await userEvent.type(screen.getByLabelText(/title/i), 'Handbook v2');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(method).toBe('PUT'));
  });
});
