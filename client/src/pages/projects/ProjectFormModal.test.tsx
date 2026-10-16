import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { projectsReducer } from '../../store/projects/projectsSlice';
import type { ProjectRow } from '../../types/project';
import { ProjectFormModal } from './ProjectFormModal';

function renderModal(record: ProjectRow | null) {
  const store = configureStore({ reducer: { projects: projectsReducer } });
  const onClose = vi.fn();
  render(
    <Provider store={store}>
      <ProjectFormModal open record={record} onClose={onClose} />
    </Provider>
  );
  return { store, onClose };
}

function mockList() {
  server.use(
    http.get(`${API_BASE_URL}/projects`, () => HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } }))
  );
}

describe('ProjectFormModal', () => {
  it('creates a project with the entered values', async () => {
    mockList();
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${API_BASE_URL}/projects`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            success: true,
            data: { id: 'p1', name: 'Website Revamp', description: 'Redesign the marketing site', deadline: '2026-09-30T00:00:00.000Z', status: 'planning' },
          },
          { status: 201 }
        );
      })
    );
    renderModal(null);

    await userEvent.type(screen.getByLabelText(/name/i), 'Website Revamp');
    await userEvent.type(screen.getByLabelText(/description/i), 'Redesign the marketing site');
    await userEvent.type(screen.getByLabelText(/deadline/i), '2026-09-30{enter}');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(body).toMatchObject({ name: 'Website Revamp', description: 'Redesign the marketing site' }));
    // The wire value is a UTC ISO string, so a raw substring check on '2026-09-30'
    // is timezone-brittle (it shifts to the previous day in any positive-UTC-offset
    // zone). Round-tripping through dayjs's local-time formatting verifies the
    // entered calendar date was preserved, independent of the runtime's timezone.
    expect(dayjs(String(body.deadline)).format('YYYY-MM-DD')).toBe('2026-09-30');
  });

  it('requires the mandatory fields', async () => {
    mockList();
    renderModal(null);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
  });

  it('surfaces a server-side field error on the field, not just the banner', async () => {
    mockList();
    let called = false;
    server.use(
      http.post(`${API_BASE_URL}/projects`, () => {
        called = true;
        return HttpResponse.json(
          { success: false, error: { message: 'Validation failed', details: { fieldErrors: { name: ['That name is not allowed'] } } } },
          { status: 400 }
        );
      })
    );
    renderModal(null);

    // Every field is filled validly so client-side Zod passes and the request
    // genuinely reaches the mock — the message can only come from the server.
    await userEvent.type(screen.getByLabelText(/name/i), 'Website Revamp');
    await userEvent.type(screen.getByLabelText(/description/i), 'Redesign the marketing site');
    await userEvent.type(screen.getByLabelText(/deadline/i), '2026-09-30{enter}');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText('That name is not allowed')).toBeInTheDocument();
    expect(called).toBe(true);
  });

  it('edits an existing project with PUT', async () => {
    mockList();
    let method = '';
    server.use(
      http.put(`${API_BASE_URL}/projects/p1`, async ({ request }) => {
        method = request.method;
        return HttpResponse.json({
          success: true,
          data: { id: 'p1', name: 'Website Revamp v2', description: 'Redesign the marketing site', deadline: '2026-09-30T00:00:00.000Z', status: 'planning' },
        });
      })
    );
    renderModal({ id: 'p1', name: 'Website Revamp', description: 'Redesign the marketing site', deadline: '2026-09-30T00:00:00.000Z', status: 'planning' });

    await userEvent.clear(screen.getByLabelText(/name/i));
    await userEvent.type(screen.getByLabelText(/name/i), 'Website Revamp v2');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(method).toBe('PUT'));
  });
});
