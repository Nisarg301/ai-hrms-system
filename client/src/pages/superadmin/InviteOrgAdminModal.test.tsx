import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { adminUsersReducer } from '../../store/adminUsers/adminUsersSlice';
import { InviteOrgAdminModal } from './InviteOrgAdminModal';

function renderModal() {
  const store = configureStore({ reducer: { adminUsers: adminUsersReducer } });
  const onClose = vi.fn();
  render(
    <Provider store={store}>
      <InviteOrgAdminModal open onClose={onClose} />
    </Provider>
  );
  return { store, onClose };
}

const ORGS = [
  { id: 'o1', name: 'Acme Corp', isActive: true, createdAt: '2026-07-01T00:00:00.000Z' },
  { id: 'o2', name: 'Globex', isActive: true, createdAt: '2026-07-01T00:00:00.000Z' },
];

function mockOrgs() {
  server.use(
    http.get(`${API_BASE_URL}/superadmin/organizations`, () =>
      HttpResponse.json({ success: true, data: ORGS, meta: { page: 1, limit: 100, total: 2 } })
    )
  );
}

describe('InviteOrgAdminModal', () => {
  it('sends organizationName when creating a new organization', async () => {
    mockOrgs();
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${API_BASE_URL}/superadmin/invite-org-admin`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            success: true,
            data: { user: { id: 'a2', name: 'Bob', email: 'bob@new.com', organizationId: 'o9' }, temp_password: 'Tmp!2345' },
          },
          { status: 201 }
        );
      })
    );
    renderModal();

    await userEvent.type(screen.getByLabelText('Name'), 'Bob Boss');
    await userEvent.type(screen.getByLabelText(/email/i), 'bob@new.com');
    await userEvent.type(screen.getByLabelText(/new organization name/i), 'Newco');
    await userEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => expect(body).toEqual({ name: 'Bob Boss', email: 'bob@new.com', organizationName: 'Newco' }));
  });

  it('sends organizationId when picking an existing organization', async () => {
    mockOrgs();
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${API_BASE_URL}/superadmin/invite-org-admin`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            success: true,
            data: { user: { id: 'a3', name: 'Cara', email: 'cara@acme.com', organizationId: 'o1' }, temp_password: 'Tmp!9999' },
          },
          { status: 201 }
        );
      })
    );
    renderModal();

    await userEvent.click(screen.getByRole('radio', { name: /existing organization/i }));
    await userEvent.type(screen.getByLabelText('Name'), 'Cara Chief');
    await userEvent.type(screen.getByLabelText(/email/i), 'cara@acme.com');

    await userEvent.click(screen.getByLabelText('Organization', { selector: 'input' }));
    await userEvent.click(await screen.findByTitle('Acme Corp'));

    await userEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => expect(body).toEqual({ name: 'Cara Chief', email: 'cara@acme.com', organizationId: 'o1' }));
  });

  it('stores the temp password so it can be shown once', async () => {
    mockOrgs();
    server.use(
      http.post(`${API_BASE_URL}/superadmin/invite-org-admin`, () =>
        HttpResponse.json(
          {
            success: true,
            data: { user: { id: 'a2', name: 'Bob', email: 'bob@new.com', organizationId: 'o9' }, temp_password: 'Tmp!2345' },
          },
          { status: 201 }
        )
      )
    );
    const { store } = renderModal();

    await userEvent.type(screen.getByLabelText('Name'), 'Bob Boss');
    await userEvent.type(screen.getByLabelText(/email/i), 'bob@new.com');
    await userEvent.type(screen.getByLabelText(/new organization name/i), 'Newco');
    await userEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => expect(store.getState().adminUsers.tempPassword).toBe('Tmp!2345'));
  });

  it('surfaces a duplicate-email conflict from the server', async () => {
    mockOrgs();
    server.use(
      http.post(`${API_BASE_URL}/superadmin/invite-org-admin`, () =>
        HttpResponse.json({ success: false, error: { message: 'A user with this email already exists' } }, { status: 409 })
      )
    );
    renderModal();

    await userEvent.type(screen.getByLabelText('Name'), 'Bob Boss');
    await userEvent.type(screen.getByLabelText(/email/i), 'taken@acme.com');
    await userEvent.type(screen.getByLabelText(/new organization name/i), 'Newco');
    await userEvent.click(screen.getByRole('button', { name: /send invite/i }));

    expect(await screen.findByText('A user with this email already exists')).toBeInTheDocument();
  });

  it('surfaces a server-side field error next to the field, not just in the banner', async () => {
    mockOrgs();
    let called = false;
    server.use(
      http.post(`${API_BASE_URL}/superadmin/invite-org-admin`, () => {
        called = true;
        return HttpResponse.json(
          {
            success: false,
            error: {
              message: 'Validation failed',
              details: { fieldErrors: { organizationName: ['This organization name is already taken'] } },
            },
          },
          { status: 400 }
        );
      })
    );
    renderModal();

    // Every field is filled in validly (client-side Zod has nothing to say)
    // so the submit actually reaches the mocked API and the message that
    // appears can only have come from the server's fieldErrors.
    await userEvent.type(screen.getByLabelText('Name'), 'Bob Boss');
    await userEvent.type(screen.getByLabelText(/email/i), 'bob@new.com');
    await userEvent.type(screen.getByLabelText(/new organization name/i), 'Newco');
    await userEvent.click(screen.getByRole('button', { name: /send invite/i }));

    expect(await screen.findByText('This organization name is already taken')).toBeInTheDocument();
    expect(called).toBe(true);
  });

  it('validates the email client-side without calling the API', async () => {
    mockOrgs();
    renderModal();

    await userEvent.type(screen.getByLabelText('Name'), 'Bob Boss');
    await userEvent.type(screen.getByLabelText(/email/i), 'not-an-email');
    await userEvent.type(screen.getByLabelText(/new organization name/i), 'Newco');
    await userEvent.click(screen.getByRole('button', { name: /send invite/i }));

    expect(await screen.findByText(/enter a valid email/i)).toBeInTheDocument();
  });
});
