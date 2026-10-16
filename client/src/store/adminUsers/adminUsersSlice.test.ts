import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import { pageChanged, searchChanged } from './adminUsersSlice';
import { fetchAdminUsers, inviteOrgAdmin } from './adminUsersThunks';

// fetchAdminUsers is typed against the app's full RootState, so the test store
// uses the real root reducer even though only adminUsers is under test.
function makeStore() {
  return makeTestStore();
}

const ROW = {
  id: 'a1',
  name: 'Ann Admin',
  email: 'ann@acme.com',
  organizationId: 'o1',
  organizationName: 'Acme Corp',
  status: 'active',
  createdAt: '2026-07-01T00:00:00.000Z',
};

describe('adminUsersSlice', () => {
  it('stores rows and pagination meta from the server', async () => {
    server.use(
      http.get(`${API_BASE_URL}/superadmin/admin-users`, () =>
        HttpResponse.json({ success: true, data: [ROW], meta: { page: 1, limit: 10, total: 1 } })
      )
    );
    const store = makeStore();

    await store.dispatch(fetchAdminUsers());

    const state = store.getState().adminUsers;
    expect(state.items).toEqual([ROW]);
    expect(state.total).toBe(1);
    expect(state.status).toBe('succeeded');
  });

  it('sends page, limit, and search as query params', async () => {
    let url = '';
    server.use(
      http.get(`${API_BASE_URL}/superadmin/admin-users`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ success: true, data: [], meta: { page: 2, limit: 5, total: 0 } });
      })
    );
    const store = makeStore();
    store.dispatch(searchChanged('ann'));
    store.dispatch(pageChanged({ page: 2, limit: 5 }));

    await store.dispatch(fetchAdminUsers());

    expect(url).toContain('page=2');
    expect(url).toContain('limit=5');
    expect(url).toContain('search=ann');
  });

  it('resets to page 1 when the search changes', () => {
    const store = makeStore();
    store.dispatch(pageChanged({ page: 3, limit: 10 }));
    store.dispatch(searchChanged('bob'));
    expect(store.getState().adminUsers.page).toBe(1);
  });

  it('records the error message on failure', async () => {
    server.use(
      http.get(`${API_BASE_URL}/superadmin/admin-users`, () =>
        HttpResponse.json({ success: false, error: { message: 'Super Admin access required' } }, { status: 403 })
      )
    );
    const store = makeStore();

    await store.dispatch(fetchAdminUsers());

    const state = store.getState().adminUsers;
    expect(state.status).toBe('failed');
    expect(state.error).toBe('Super Admin access required');
  });

  it('stores the temp password returned by an invite', async () => {
    server.use(
      http.post(`${API_BASE_URL}/superadmin/invite-org-admin`, () =>
        HttpResponse.json(
          {
            success: true,
            data: {
              user: { id: 'a2', name: 'Bob', email: 'bob@acme.com', organizationId: 'o1' },
              temp_password: 'Tmp!23456789',
            },
          },
          { status: 201 }
        )
      )
    );
    const store = makeStore();

    await store.dispatch(inviteOrgAdmin({ name: 'Bob', email: 'bob@acme.com', organizationName: 'Acme Corp' }));

    expect(store.getState().adminUsers.tempPassword).toBe('Tmp!23456789');
  });
});
