import { configureStore } from '@reduxjs/toolkit';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { getAccessToken, setAccessToken } from '../../services/tokenStore';
import type { AuthUser } from '../../types/auth';
import { authReducer, sessionCleared } from './authSlice';
import { bootstrapSession, login, logout } from './authThunks';

function makeStore() {
  return configureStore({ reducer: { auth: authReducer } });
}

const USER: AuthUser = {
  id: 'u1',
  name: 'Ann Admin',
  email: 'ann@acme.com',
  role: 'ORG_ADMIN',
  organizationId: 'o1',
  roleId: null,
  mustChangePassword: false,
  permissions: { scope: 'all' },
};

afterEach(() => {
  setAccessToken(null);
});

describe('authSlice', () => {
  it('starts unauthenticated and not bootstrapped', () => {
    const state = makeStore().getState().auth;
    expect(state.user).toBeNull();
    expect(state.status).toBe('idle');
    expect(state.bootstrapped).toBe(false);
  });

  it('login stores the user and the access token', async () => {
    server.use(
      http.post(`${API_BASE_URL}/auth/login`, () =>
        HttpResponse.json({ success: true, data: { accessToken: 'tok', user: USER } })
      )
    );
    const store = makeStore();

    await store.dispatch(login({ email: 'ann@acme.com', password: 'pw' }));

    const state = store.getState().auth;
    expect(state.status).toBe('authenticated');
    expect(state.user).toEqual(USER);
    expect(getAccessToken()).toBe('tok');
  });

  it('login failure records the error message and stays unauthenticated', async () => {
    server.use(
      http.post(`${API_BASE_URL}/auth/login`, () =>
        HttpResponse.json({ success: false, error: { message: 'Invalid email or password' } }, { status: 401 })
      )
    );
    const store = makeStore();

    await store.dispatch(login({ email: 'ann@acme.com', password: 'wrong' }));

    const state = store.getState().auth;
    expect(state.status).toBe('unauthenticated');
    expect(state.user).toBeNull();
    expect(state.error).toBe('Invalid email or password');
  });

  it('bootstrapSession refreshes then loads the profile', async () => {
    server.use(
      http.post(`${API_BASE_URL}/auth/refresh`, () =>
        HttpResponse.json({ success: true, data: { accessToken: 'fresh' } })
      ),
      http.get(`${API_BASE_URL}/auth/me`, () => HttpResponse.json({ success: true, data: { user: USER } }))
    );
    const store = makeStore();

    await store.dispatch(bootstrapSession());

    const state = store.getState().auth;
    expect(state.status).toBe('authenticated');
    expect(state.user).toEqual(USER);
    expect(state.bootstrapped).toBe(true);
  });

  it('bootstrapSession marks bootstrapped even when there is no session', async () => {
    server.use(
      http.post(`${API_BASE_URL}/auth/refresh`, () =>
        HttpResponse.json({ success: false, error: { message: 'Missing refresh token' } }, { status: 401 })
      )
    );
    const store = makeStore();

    await store.dispatch(bootstrapSession());

    const state = store.getState().auth;
    expect(state.status).toBe('unauthenticated');
    expect(state.user).toBeNull();
    expect(state.bootstrapped).toBe(true);
  });

  it('logout clears the user and the token', async () => {
    server.use(
      http.post(`${API_BASE_URL}/auth/login`, () =>
        HttpResponse.json({ success: true, data: { accessToken: 'tok', user: USER } })
      ),
      http.post(`${API_BASE_URL}/auth/logout`, () => HttpResponse.json({ success: true, data: { loggedOut: true } }))
    );
    const store = makeStore();
    await store.dispatch(login({ email: 'ann@acme.com', password: 'pw' }));

    await store.dispatch(logout());

    const state = store.getState().auth;
    expect(state.status).toBe('unauthenticated');
    expect(state.user).toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it('sessionCleared resets the session synchronously', () => {
    const store = makeStore();
    store.dispatch(sessionCleared());
    expect(store.getState().auth.status).toBe('unauthenticated');
    expect(store.getState().auth.user).toBeNull();
  });
});
