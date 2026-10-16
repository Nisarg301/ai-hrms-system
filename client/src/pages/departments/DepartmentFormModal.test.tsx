import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { departmentsReducer } from '../../store/departments/departmentsSlice';
import type { DepartmentRow } from '../../types/department';
import { DepartmentFormModal } from './DepartmentFormModal';

function renderModal(record: DepartmentRow | null) {
  const store = configureStore({ reducer: { departments: departmentsReducer } });
  const onClose = vi.fn();
  render(
    <Provider store={store}>
      <DepartmentFormModal open record={record} onClose={onClose} />
    </Provider>
  );
  return { store, onClose };
}

function mockList() {
  server.use(
    http.get(`${API_BASE_URL}/departments`, () => HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } }))
  );
}

describe('DepartmentFormModal', () => {
  it('creates a department with the entered values', async () => {
    mockList();
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${API_BASE_URL}/departments`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          { success: true, data: { id: 'd1', title: 'Engineering', description: 'Builds the product', status: 'active' } },
          { status: 201 }
        );
      })
    );
    const { onClose } = renderModal(null);

    expect(screen.getByText('Add department')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/title/i), 'Engineering');
    await userEvent.type(screen.getByLabelText(/description/i), 'Builds the product');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(body).toMatchObject({ title: 'Engineering', description: 'Builds the product', status: 'active' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('requires the mandatory fields', async () => {
    mockList();
    renderModal(null);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(screen.getByText(/description is required/i)).toBeInTheDocument();
  });

  it('surfaces a server-side field error on the field, not just the banner', async () => {
    mockList();
    let called = false;
    server.use(
      http.post(`${API_BASE_URL}/departments`, () => {
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
    await userEvent.type(screen.getByLabelText(/title/i), 'Engineering');
    await userEvent.type(screen.getByLabelText(/description/i), 'Builds the product');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText('That title is not allowed')).toBeInTheDocument();
    expect(called).toBe(true);
  });

  it('edits an existing department with PUT', async () => {
    mockList();
    let method = '';
    let body: Record<string, unknown> = {};
    server.use(
      http.put(`${API_BASE_URL}/departments/d1`, async ({ request }) => {
        method = request.method;
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: { id: 'd1', title: 'Platform', description: 'Builds the product', status: 'active' } });
      })
    );
    renderModal({ id: 'd1', title: 'Engineering', description: 'Builds the product', status: 'active' });

    expect(screen.getByText('Edit department')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/title/i));
    await userEvent.type(screen.getByLabelText(/title/i), 'Platform');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(method).toBe('PUT'));
    expect(body).toMatchObject({ title: 'Platform' });
  });
});
