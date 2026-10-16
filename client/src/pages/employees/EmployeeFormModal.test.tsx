import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import dayjs from 'dayjs';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import type { EmployeeRow } from '../../types/employee';
import { EmployeeFormModal } from './EmployeeFormModal';

const IVY: EmployeeRow = {
  id: 'e1',
  name: 'Ivy',
  email: 'ivy@acme.com',
  jobTitle: 'Engineer',
  department: 'dep1',
  departmentName: 'R&D',
  roleId: 'r1',
  roleName: 'Engineer Role',
  status: 'active',
  reportsTo: null,
  reportsToName: null,
  joiningDate: '2026-01-05',
  dateOfBirth: null,
};

function person(id: string, name: string, jobTitle: string | null = null) {
  return { id, name, jobTitle, departmentName: null, avatarUrl: null, role: 'ORG_USER', reportsTo: null, joiningDate: '2025-01-01' };
}

function renderModal(employee: EmployeeRow | null) {
  const store = makeTestStore();
  const onClose = vi.fn();
  render(
    <Provider store={store}>
      <EmployeeFormModal open employee={employee} onClose={onClose} />
    </Provider>
  );
  return { store, onClose };
}

function mockList() {
  server.use(
    http.get(`${API_BASE_URL}/employees`, () => HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } }))
  );
}

/** Onboarding templates the Add employee form offers (none unless a test sets some). */
let templates: object[] = [];

// The modal loads roles, departments and people (for Reports to) whenever it opens, and templates when adding.
function mockRoles() {
  server.use(
    http.get(`${API_BASE_URL}/checklist-templates`, () => HttpResponse.json({ success: true, data: templates })),
    http.get(`${API_BASE_URL}/people`, () =>
      HttpResponse.json({ success: true, data: [person('e1', 'Ivy', 'Engineer'), person('m1', 'Maya Shah', 'Engineering Manager'), person('m2', 'Omar Old')] })
    ),
    http.get(`${API_BASE_URL}/roles`, () =>
      HttpResponse.json({ success: true, data: [{ id: 'r1', name: 'Engineer Role', permissions: [] }], meta: { page: 1, limit: 10, total: 1 } })
    ),
    http.get(`${API_BASE_URL}/departments`, () =>
      HttpResponse.json({
        success: true,
        data: [{ id: 'dep1', title: 'R&D', description: 'Research', status: 'active' }],
        meta: { page: 1, limit: 999999, total: 1 },
      })
    )
  );
}

async function pickDepartment() {
  await userEvent.click(screen.getByLabelText(/department/i, { selector: 'input' }));
  await userEvent.click(await screen.findByTitle('R&D'));
}

beforeEach(() => {
  templates = [];
});

describe('EmployeeFormModal', () => {
  it('creates an employee with the entered values and selected role', async () => {
    mockList();
    mockRoles();
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${API_BASE_URL}/employees`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            success: true,
            data: {
              user: { id: 'e1', name: 'Ivy', email: 'ivy@acme.com', jobTitle: 'Engineer', department: 'dep1', departmentName: 'R&D', roleId: 'r1', roleName: 'Engineer Role', status: 'active' },
              temp_password: 'Tmp!23456789',
            },
          },
          { status: 201 }
        );
      })
    );
    renderModal(null);

    await userEvent.type(screen.getByLabelText(/name/i), 'Ivy');
    await userEvent.type(screen.getByLabelText(/email/i), 'ivy@acme.com');
    await userEvent.type(screen.getByLabelText(/job title/i), 'Engineer');
    await pickDepartment();
    await userEvent.click(screen.getByLabelText(/role/i, { selector: 'input' }));
    await userEvent.click(await screen.findByTitle('Engineer Role'));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(body).toMatchObject({ name: 'Ivy', email: 'ivy@acme.com', jobTitle: 'Engineer', department: 'dep1', roleId: 'r1' }));
  });

  it('requires the mandatory fields, including role', async () => {
    mockList();
    mockRoles();
    renderModal(null);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(await screen.findByText(/role is required/i)).toBeInTheDocument();
  });

  it('does not show a status field when creating', async () => {
    mockList();
    mockRoles();
    renderModal(null);
    expect(screen.queryByLabelText(/^status$/i)).not.toBeInTheDocument();
  });

  it('shows a status field when editing', async () => {
    mockList();
    mockRoles();
    renderModal(IVY);
    expect(await screen.findByLabelText(/^status$/i)).toBeInTheDocument();
  });

  it('surfaces a server-side email conflict on the email field, not just the banner', async () => {
    mockList();
    mockRoles();
    let called = false;
    server.use(
      http.post(`${API_BASE_URL}/employees`, () => {
        called = true;
        return HttpResponse.json(
          { success: false, error: { message: 'Validation failed', details: { fieldErrors: { email: ['A user with this email already exists'] } } } },
          { status: 400 }
        );
      })
    );
    renderModal(null);

    await userEvent.type(screen.getByLabelText(/name/i), 'Ivy');
    await userEvent.type(screen.getByLabelText(/email/i), 'ivy@acme.com');
    await userEvent.type(screen.getByLabelText(/job title/i), 'Engineer');
    await pickDepartment();
    await userEvent.click(screen.getByLabelText(/role/i, { selector: 'input' }));
    await userEvent.click(await screen.findByTitle('Engineer Role'));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText('A user with this email already exists')).toBeInTheDocument();
    expect(called).toBe(true);
  });

  it('edits an existing employee with PUT, submitting its role and status unchanged', async () => {
    mockList();
    mockRoles();
    let method = '';
    let body: Record<string, unknown> = {};
    server.use(
      http.put(`${API_BASE_URL}/employees/e1`, async ({ request }) => {
        method = request.method;
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          success: true,
          data: { id: 'e1', name: 'Ivy R', email: 'ivy@acme.com', jobTitle: 'Engineer', department: 'dep1', departmentName: 'R&D', roleId: 'r1', roleName: 'Engineer Role', status: 'active' },
        });
      })
    );
    renderModal(IVY);

    await userEvent.clear(screen.getByLabelText(/name/i));
    await userEvent.type(screen.getByLabelText(/name/i), 'Ivy R');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(method).toBe('PUT'));
    expect(body).toMatchObject({ name: 'Ivy R', roleId: 'r1', status: 'active' });
  });

  it('offers everyone but the employee as a manager, and sends the manager and joining date', async () => {
    mockList();
    mockRoles();
    let body: Record<string, unknown> = {};
    server.use(
      http.put(`${API_BASE_URL}/employees/e1`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: { ...IVY, reportsTo: 'm1', reportsToName: 'Maya Shah' } });
      })
    );
    renderModal(IVY);
    expect(screen.getByLabelText('Date of joining')).toHaveValue('05 Jan 2026');

    await userEvent.click(screen.getByLabelText('Reports to', { selector: 'input' }));
    expect(await screen.findByTitle('Maya Shah · Engineering Manager')).toBeInTheDocument();
    expect(screen.getByTitle('Omar Old')).toBeInTheDocument();
    expect(screen.queryByTitle('Ivy · Engineer')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTitle('Maya Shah · Engineering Manager'));

    await userEvent.clear(screen.getByLabelText('Date of joining'));
    await userEvent.type(screen.getByLabelText('Date of joining'), '2026-02-01{enter}');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(body).toMatchObject({ reportsTo: 'm1', joiningDate: '2026-02-01' }));
  });

  it('clears the manager with null', async () => {
    mockList();
    mockRoles();
    let body: Record<string, unknown> = {};
    server.use(
      http.put(`${API_BASE_URL}/employees/e1`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: IVY });
      })
    );
    renderModal({ ...IVY, reportsTo: 'm1', reportsToName: 'Maya Shah' });
    expect(await screen.findByTitle('Maya Shah · Engineering Manager')).toBeInTheDocument();
    const select = screen.getByLabelText('Reports to', { selector: 'input' }).closest('.ant-select') as HTMLElement;
    await userEvent.click(select.querySelector('.ant-select-clear') as HTMLElement);
    expect(screen.queryByTitle('Maya Shah · Engineering Manager')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(body).toHaveProperty('reportsTo', null));
  });

  it('shows a reporting-loop error on the Reports to field', async () => {
    mockList();
    mockRoles();
    server.use(
      http.put(`${API_BASE_URL}/employees/e1`, () =>
        HttpResponse.json(
          { success: false, error: { message: 'Validation failed', details: { fieldErrors: { reportsTo: ['This would create a reporting loop'] } } } },
          { status: 400 }
        )
      )
    );
    renderModal(IVY);
    await userEvent.click(screen.getByLabelText('Reports to', { selector: 'input' }));
    await userEvent.click(await screen.findByTitle('Omar Old'));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    const help = await screen.findByText('This would create a reporting loop');
    expect(help.closest('.ant-form-item')).toContainElement(screen.getByLabelText('Reports to', { selector: 'input' }));
  });

  it("still names a current manager who has since been disabled", async () => {
    mockList();
    mockRoles();
    renderModal({ ...IVY, reportsTo: 'gone1', reportsToName: 'Zed Former' });
    expect(await screen.findByTitle('Zed Former (inactive)')).toBeInTheDocument();
  });

  it('sets and clears the date of birth', async () => {
    mockList();
    mockRoles();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.put(`${API_BASE_URL}/employees/e1`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ success: true, data: IVY });
      })
    );
    renderModal(IVY);
    expect(screen.getByText('Colleagues only ever see the day and month.')).toBeInTheDocument();
    const dob = screen.getByLabelText('Date of birth (optional)');
    await userEvent.type(dob, '1995-03-12{enter}');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(bodies.at(-1)).toMatchObject({ dateOfBirth: '1995-03-12' }));
  });

  it('shows an existing date of birth and sends null once cleared', async () => {
    mockList();
    mockRoles();
    let body: Record<string, unknown> = {};
    server.use(
      http.put(`${API_BASE_URL}/employees/e1`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: IVY });
      })
    );
    renderModal({ ...IVY, dateOfBirth: '1995-03-12' });
    const dob = screen.getByLabelText('Date of birth (optional)');
    expect(dob).toHaveValue('12 Mar 1995');
    // The picker's × clears it.
    await userEvent.click(dob.closest('.ant-picker')!.querySelector('.ant-picker-clear') as HTMLElement);
    expect(dob).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(body).toHaveProperty('dateOfBirth', null));
  });
});

describe('Add employee with onboarding', () => {
  const template = (id: string, name: string, isDefault: boolean) => ({ id, name, kind: 'onboarding', isDefault, tasks: [], updatedAt: '2026-09-30T00:00:00.000Z' });
  let body: Record<string, unknown>;

  beforeEach(() => {
    templates = [template('t2', 'Interns', false), template('t1', 'Standard onboarding', true), { ...template('t9', 'Standard offboarding', true), kind: 'offboarding' }];
    body = {};
    mockList();
    mockRoles();
    server.use(
      http.post(`${API_BASE_URL}/employees`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        if ((body.onboarding as { buddyId?: string } | undefined)?.buddyId === 'm2') {
          return HttpResponse.json(
            { success: false, error: { message: 'Validation failed', details: { fieldErrors: { buddyId: ['Choose an active member of your organization'] } } } },
            { status: 400 }
          );
        }
        return HttpResponse.json({ success: true, data: { user: { ...IVY, lifecycle: { kind: 'onboarding', anchorDate: '2026-10-12' } }, temp_password: 'Tmp!23456789' } }, { status: 201 });
      })
    );
  });

  async function fillRequired() {
    await userEvent.type(screen.getByLabelText(/name/i), 'Ivy');
    await userEvent.type(screen.getByLabelText(/email/i), 'ivy@acme.com');
    await userEvent.type(screen.getByLabelText(/job title/i), 'Engineer');
    await pickDepartment();
    await userEvent.click(screen.getByLabelText(/role/i, { selector: 'input' }));
    await userEvent.click(await screen.findByTitle('Engineer Role'));
  }

  it('starts onboarding by default, with the default template and an optional buddy', async () => {
    const { onClose } = renderModal(null);
    expect(await screen.findByLabelText('Start onboarding')).toBeChecked();
    expect(await screen.findByTitle('Standard onboarding (default)')).toBeInTheDocument();
    await fillRequired();
    await userEvent.click(screen.getByLabelText('Buddy (optional)'));
    await userEvent.click(await screen.findByTitle('Maya Shah · Engineering Manager'));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(body.onboarding).toEqual({ templateId: 't1', buddyId: 'm1' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('can be switched off', async () => {
    renderModal(null);
    await userEvent.click(await screen.findByLabelText('Start onboarding'));
    expect(screen.queryByLabelText('Onboarding template')).not.toBeInTheDocument();
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(body).toMatchObject({ name: 'Ivy' }));
    expect(body).not.toHaveProperty('onboarding');
  });

  it("shows the server's problem with the onboarding next to it", async () => {
    const { onClose } = renderModal(null);
    await screen.findByTitle('Standard onboarding (default)');
    await fillRequired();
    await userEvent.click(screen.getByLabelText('Buddy (optional)'));
    await userEvent.click(await screen.findByTitle('Omar Old'));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText('Choose an active member of your organization')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('is turned off for someone who joined more than 30 days ago', async () => {
    renderModal(null);
    expect(await screen.findByLabelText('Start onboarding')).toBeChecked();
    await screen.findByTitle('Standard onboarding (default)');
    await fillRequired();
    const joining = screen.getByLabelText('Date of joining');
    await userEvent.type(joining, `${dayjs().subtract(45, 'day').format('YYYY-MM-DD')}{enter}`);
    expect(screen.getByLabelText('Start onboarding')).not.toBeChecked();
    expect(screen.getByLabelText('Start onboarding')).toBeDisabled();
    expect(screen.getByText('Onboarding is for new joiners. This joining date is more than 30 days ago.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(body).toMatchObject({ name: 'Ivy' }));
    expect(body).not.toHaveProperty('onboarding');
  });

  it('is not offered when editing', async () => {
    renderModal(IVY);
    await screen.findByLabelText(/^status$/i);
    expect(screen.queryByLabelText('Start onboarding')).not.toBeInTheDocument();
  });
});
