import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL, setOnPlanExpired } from '../../services/api';
import { callApiServices } from '../../services/callApiServices';
import { makeTestStore } from '../../test/makeTestStore';
import { activeSubscription } from '../../test/fixtures';
import type { AuthUser } from '../../types/auth';
import { planLapsed, type AuthState } from './authSlice';
import { refreshCurrentUser } from './authThunks';

const ADMIN: AuthUser = {
  id: 'u1',
  name: 'Ann',
  email: 'ann@acme.com',
  role: 'ORG_ADMIN',
  organizationId: 'o1',
  roleId: null,
  mustChangePassword: false,
  permissions: { scope: 'all' },
  subscription: activeSubscription('professional'),
};

function storeWith(user: AuthUser | null) {
  const auth: AuthState = { user, status: user ? 'authenticated' : 'unauthenticated', bootstrapped: true, error: null, resetToken: null };
  return makeTestStore({ auth });
}

afterEach(() => setOnPlanExpired(null));

describe('planLapsed', () => {
  it('marks the plan inactive and clears its modules', () => {
    const store = storeWith(ADMIN);
    store.dispatch(planLapsed());
    expect(store.getState().auth.user?.subscription).toMatchObject({ planType: 'professional', active: false, modules: [] });
  });

  it('does nothing without a signed-in org user', () => {
    const store = storeWith(null);
    store.dispatch(planLapsed());
    expect(store.getState().auth.user).toBeNull();
  });
});

describe('refreshCurrentUser', () => {
  it('replaces the user without touching the session status', async () => {
    const renewed = { ...ADMIN, subscription: activeSubscription('basic', 365) };
    server.use(http.get(`${API_BASE_URL}/auth/me`, () => HttpResponse.json({ success: true, data: { user: renewed } })));
    const store = storeWith({ ...ADMIN, subscription: { ...ADMIN.subscription!, active: false, modules: [] } });

    const pending = store.dispatch(refreshCurrentUser());
    expect(store.getState().auth.status).toBe('authenticated');
    await pending;

    expect(store.getState().auth.status).toBe('authenticated');
    expect(store.getState().auth.user?.subscription).toEqual(renewed.subscription);
  });
});

describe('402 from the API', () => {
  it('notifies the plan-expired handler and still rejects the call', async () => {
    const onPlanExpired = vi.fn();
    setOnPlanExpired(onPlanExpired);
    server.use(
      http.get(`${API_BASE_URL}/employees`, () =>
        HttpResponse.json({ success: false, error: { message: 'Your organization plan has expired', details: { code: 'PLAN_EXPIRED' } } }, { status: 402 })
      )
    );

    await expect(callApiServices('/employees', 'get', true)).rejects.toMatchObject({ status: 402 });
    expect(onPlanExpired).toHaveBeenCalledTimes(1);
  });

  it('does not fire for other errors', async () => {
    const onPlanExpired = vi.fn();
    setOnPlanExpired(onPlanExpired);
    server.use(http.get(`${API_BASE_URL}/employees`, () => HttpResponse.json({ success: false, error: { message: 'Forbidden' } }, { status: 403 })));

    await expect(callApiServices('/employees', 'get', true)).rejects.toMatchObject({ status: 403 });
    expect(onPlanExpired).not.toHaveBeenCalled();
  });
});
