import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/setup';
import { callApiServices } from './callApiServices';
import { API_BASE_URL, setOnAuthFailure } from './api';
import { getAccessToken, setAccessToken } from './tokenStore';

afterEach(() => {
  setAccessToken(null);
  setOnAuthFailure(null);
});

describe('401 refresh-and-retry', () => {
  it('refreshes once and replays the original request with the new token', async () => {
    setAccessToken('expired');
    let refreshCalls = 0;
    const authHeaders: Array<string | null> = [];

    server.use(
      http.post(`${API_BASE_URL}/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json({ success: true, data: { accessToken: 'fresh' } });
      }),
      http.get(`${API_BASE_URL}/protected`, ({ request }) => {
        const auth = request.headers.get('authorization');
        authHeaders.push(auth);
        if (auth === 'Bearer expired') {
          return HttpResponse.json({ success: false, error: { message: 'Invalid or expired token' } }, { status: 401 });
        }
        return HttpResponse.json({ success: true, data: { ok: true } });
      })
    );

    const result = await callApiServices<{ ok: boolean }>('/protected', 'get', true);

    expect(result.data).toEqual({ ok: true });
    expect(refreshCalls).toBe(1);
    expect(authHeaders).toEqual(['Bearer expired', 'Bearer fresh']);
    expect(getAccessToken()).toBe('fresh');
  });

  it('triggers exactly one refresh for concurrent 401s', async () => {
    setAccessToken('expired');
    let refreshCalls = 0;

    server.use(
      http.post(`${API_BASE_URL}/auth/refresh`, async () => {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json({ success: true, data: { accessToken: 'fresh' } });
      }),
      http.get(`${API_BASE_URL}/a`, ({ request }) =>
        request.headers.get('authorization') === 'Bearer expired'
          ? HttpResponse.json({ success: false, error: { message: 'expired' } }, { status: 401 })
          : HttpResponse.json({ success: true, data: 'a' })
      ),
      http.get(`${API_BASE_URL}/b`, ({ request }) =>
        request.headers.get('authorization') === 'Bearer expired'
          ? HttpResponse.json({ success: false, error: { message: 'expired' } }, { status: 401 })
          : HttpResponse.json({ success: true, data: 'b' })
      ),
      http.get(`${API_BASE_URL}/c`, ({ request }) =>
        request.headers.get('authorization') === 'Bearer expired'
          ? HttpResponse.json({ success: false, error: { message: 'expired' } }, { status: 401 })
          : HttpResponse.json({ success: true, data: 'c' })
      )
    );

    const results = await Promise.all([
      callApiServices<string>('/a', 'get', true),
      callApiServices<string>('/b', 'get', true),
      callApiServices<string>('/c', 'get', true),
    ]);

    expect(results.map((r) => r.data)).toEqual(['a', 'b', 'c']);
    expect(refreshCalls).toBe(1);
  });

  it('clears the token and notifies auth failure when refresh fails', async () => {
    setAccessToken('expired');
    const onFailure = vi.fn();
    setOnAuthFailure(onFailure);

    server.use(
      http.post(`${API_BASE_URL}/auth/refresh`, () =>
        HttpResponse.json({ success: false, error: { message: 'Refresh token is no longer valid' } }, { status: 401 })
      ),
      http.get(`${API_BASE_URL}/protected`, () =>
        HttpResponse.json({ success: false, error: { message: 'expired' } }, { status: 401 })
      )
    );

    await expect(callApiServices('/protected', 'get', true)).rejects.toMatchObject({ status: 401 });
    expect(getAccessToken()).toBeNull();
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('does not retry a request more than once', async () => {
    setAccessToken('expired');
    let protectedCalls = 0;

    server.use(
      http.post(`${API_BASE_URL}/auth/refresh`, () =>
        HttpResponse.json({ success: true, data: { accessToken: 'also-rejected' } })
      ),
      http.get(`${API_BASE_URL}/protected`, () => {
        protectedCalls += 1;
        return HttpResponse.json({ success: false, error: { message: 'still 401' } }, { status: 401 });
      })
    );

    await expect(callApiServices('/protected', 'get', true)).rejects.toMatchObject({ status: 401 });
    expect(protectedCalls).toBe(2);
  });

  it('does not attempt to refresh when the refresh endpoint itself 401s', async () => {
    let refreshCalls = 0;
    server.use(
      http.post(`${API_BASE_URL}/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json({ success: false, error: { message: 'Missing refresh token' } }, { status: 401 });
      })
    );

    await expect(callApiServices('/auth/refresh', 'post', false)).rejects.toMatchObject({ status: 401 });
    expect(refreshCalls).toBe(1);
  });
});
