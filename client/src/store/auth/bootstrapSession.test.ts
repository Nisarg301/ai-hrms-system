import { configureStore } from '@reduxjs/toolkit';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { setAccessToken } from '../../services/tokenStore';
import { authReducer } from './authSlice';
import { bootstrapSession } from './authThunks';

const ME_USER = {
  id: 'u1',
  name: 'U',
  email: 'u@x.com',
  role: 'ORG_ADMIN',
  organizationId: 'o1',
  roleId: null,
  mustChangePassword: false,
  permissions: { scope: 'all' },
};

afterEach(() => {
  setAccessToken(null);
  sessionStorage.clear();
});

function makeStore() {
  return configureStore({ reducer: { auth: authReducer } });
}

describe('bootstrapSession token persistence', () => {
  it('restores the session via /me WITHOUT calling /refresh when a token is stored', async () => {
    let refreshCalls = 0;
    sessionStorage.setItem('accessToken', 'stored-token');
    server.use(
      http.post(`${API_BASE_URL}/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json({ success: true, data: { accessToken: 'new' } });
      }),
      http.get(`${API_BASE_URL}/auth/me`, () => HttpResponse.json({ success: true, data: { user: ME_USER } }))
    );
    const store = makeStore();

    await store.dispatch(bootstrapSession());

    expect(store.getState().auth.user?.email).toBe('u@x.com');
    expect(refreshCalls).toBe(0);
  });

  it('falls back to /refresh when no token is stored', async () => {
    let refreshCalls = 0;
    server.use(
      http.post(`${API_BASE_URL}/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json({ success: true, data: { accessToken: 'fresh' } });
      }),
      http.get(`${API_BASE_URL}/auth/me`, () => HttpResponse.json({ success: true, data: { user: ME_USER } }))
    );
    const store = makeStore();

    await store.dispatch(bootstrapSession());

    expect(store.getState().auth.user?.email).toBe('u@x.com');
    expect(refreshCalls).toBe(1);
  });

  it('when the stored token is expired, /me 401s and the interceptor refreshes once then succeeds', async () => {
    let refreshCalls = 0;
    let meCalls = 0;
    sessionStorage.setItem('accessToken', 'expired-token');
    server.use(
      http.post(`${API_BASE_URL}/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json({ success: true, data: { accessToken: 'fresh' } });
      }),
      http.get(`${API_BASE_URL}/auth/me`, () => {
        meCalls += 1;
        // First call uses the expired stored token → 401; after the interceptor
        // refreshes and retries, the second call succeeds.
        if (meCalls === 1) {
          return HttpResponse.json({ success: false, error: { message: 'expired' } }, { status: 401 });
        }
        return HttpResponse.json({ success: true, data: { user: ME_USER } });
      })
    );
    const store = makeStore();

    await store.dispatch(bootstrapSession());

    expect(store.getState().auth.user?.email).toBe('u@x.com');
    expect(refreshCalls).toBe(1);
    expect(meCalls).toBe(2);
  });
});
