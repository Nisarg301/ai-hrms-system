import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import type { TaskRow } from '../../types/task';
import { TaskFormModal } from './TaskFormModal';

function renderModal(record: TaskRow | null) {
  const store = makeTestStore();
  const onClose = vi.fn();
  render(
    <Provider store={store}>
      <TaskFormModal open record={record} onClose={onClose} />
    </Provider>
  );
  return { store, onClose };
}

// Besides the tasks list refetch, the modal loads every project and employee
// for its Project / Members selects whenever it opens.
function mockList() {
  server.use(
    http.get(`${API_BASE_URL}/tasks`, () => HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } })),
    http.get(`${API_BASE_URL}/projects`, () =>
      HttpResponse.json({
        success: true,
        data: [{ id: 'p1', name: 'Website relaunch', description: 'd', deadline: '2026-12-31T00:00:00.000Z', status: 'planning' }],
        meta: { page: 1, limit: 999999, total: 1 },
      })
    ),
    http.get(`${API_BASE_URL}/employees`, () =>
      HttpResponse.json({
        success: true,
        data: [{ id: 'e1', name: 'Ivy', email: 'ivy@acme.com', jobTitle: 'Engineer', department: 'dep1', departmentName: 'R&D', roleId: 'r1', roleName: 'R', status: 'active' }],
        meta: { page: 1, limit: 999999, total: 1 },
      })
    )
  );
}

// Project and at least one member are required (both frontend and API).
async function pickProjectAndMember() {
  await userEvent.click(screen.getByLabelText(/project/i, { selector: 'input' }));
  await userEvent.click(await screen.findByTitle('Website relaunch'));
  await userEvent.click(screen.getByLabelText(/members/i, { selector: 'input' }));
  await userEvent.click(await screen.findByTitle('Ivy'));
}

describe('TaskFormModal', () => {
  it('creates a task with the entered values', async () => {
    mockList();
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${API_BASE_URL}/tasks`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            success: true,
            data: { id: 't1', title: 'Fix login bug', description: 'Users cannot log in with SSO', dueDate: '2026-09-30', status: 'todo' },
          },
          { status: 201 }
        );
      })
    );
    renderModal(null);

    await userEvent.type(screen.getByLabelText(/title/i), 'Fix login bug');
    await userEvent.type(screen.getByLabelText(/description/i), 'Users cannot log in with SSO');
    await userEvent.type(screen.getByLabelText(/due date/i), '2026-09-30{enter}');
    await pickProjectAndMember();
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(body).toMatchObject({ title: 'Fix login bug', description: 'Users cannot log in with SSO', projectId: 'p1', userId: ['e1'] })
    );
    // dueDate is a plain YYYY-MM-DD string end to end (no UTC-instant conversion
    // anywhere in this module), so a direct equality check is correct and safe --
    // unlike Projects' deadline, there is no timezone-dependent instant to round-trip.
    expect(body.dueDate).toBe('2026-09-30');
  });

  it('requires the mandatory fields', async () => {
    mockList();
    renderModal(null);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(screen.getByText(/project is required/i)).toBeInTheDocument();
    expect(screen.getByText(/member is required/i)).toBeInTheDocument();
  });

  it('surfaces a server-side field error on the field, not just the banner', async () => {
    mockList();
    let called = false;
    server.use(
      http.post(`${API_BASE_URL}/tasks`, () => {
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
    await userEvent.type(screen.getByLabelText(/title/i), 'Fix login bug');
    await userEvent.type(screen.getByLabelText(/description/i), 'Users cannot log in with SSO');
    await userEvent.type(screen.getByLabelText(/due date/i), '2026-09-30{enter}');
    await pickProjectAndMember();
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText('That title is not allowed')).toBeInTheDocument();
    expect(called).toBe(true);
  });

  it('edits an existing task with PUT', async () => {
    mockList();
    let method = '';
    server.use(
      http.put(`${API_BASE_URL}/tasks/t1`, async ({ request }) => {
        method = request.method;
        return HttpResponse.json({
          success: true,
          data: { id: 't1', title: 'Fix login bug v2', description: 'Users cannot log in with SSO', dueDate: '2026-09-30', status: 'todo' },
        });
      })
    );
    renderModal({ id: 't1', title: 'Fix login bug', description: 'Users cannot log in with SSO', dueDate: '2026-09-30', status: 'todo', projectId: 'p1', userId: ['e1'] });

    await userEvent.clear(screen.getByLabelText(/title/i));
    await userEvent.type(screen.getByLabelText(/title/i), 'Fix login bug v2');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(method).toBe('PUT'));
  });
});
