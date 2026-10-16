import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../test/setup';
import { ApiError } from '../types/api';
import { callApiServices } from './callApiServices';
import { API_BASE_URL } from './api';
import { setAccessToken } from './tokenStore';

afterEach(() => {
  setAccessToken(null);
});

describe('callApiServices', () => {
  it('unwraps the success envelope and returns data', async () => {
    server.use(
      http.get(`${API_BASE_URL}/thing`, () => HttpResponse.json({ success: true, data: { id: '1', name: 'Widget' } }))
    );

    const result = await callApiServices<{ id: string; name: string }>('/thing', 'get', false);

    expect(result.data).toEqual({ id: '1', name: 'Widget' });
    expect(result.meta).toBeUndefined();
  });

  it('returns meta when the envelope includes it', async () => {
    server.use(
      http.get(`${API_BASE_URL}/things`, () =>
        HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } })
      )
    );

    const result = await callApiServices<unknown[]>('/things', 'get', false);

    expect(result.meta).toEqual({ page: 1, limit: 10, total: 0 });
  });

  it('sends the bearer token only when requiresToken is true', async () => {
    setAccessToken('tok-123');
    const seen: Array<string | null> = [];
    server.use(
      http.get(`${API_BASE_URL}/thing`, ({ request }) => {
        seen.push(request.headers.get('authorization'));
        return HttpResponse.json({ success: true, data: null });
      })
    );

    await callApiServices('/thing', 'get', true);
    await callApiServices('/thing', 'get', false);

    expect(seen[0]).toBe('Bearer tok-123');
    expect(seen[1]).toBeNull();
  });

  it('sends the payload as a JSON body for post', async () => {
    let body: unknown;
    server.use(
      http.post(`${API_BASE_URL}/login`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { ok: true } });
      })
    );

    await callApiServices('/login', 'post', false, { email: 'a@b.com', password: 'secret' });

    expect(body).toEqual({ email: 'a@b.com', password: 'secret' });
  });

  it('sends the payload as query params for get', async () => {
    let url = '';
    server.use(
      http.get(`${API_BASE_URL}/things`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ success: true, data: [] });
      })
    );

    await callApiServices('/things', 'get', false, { page: 2, search: 'bob' });

    expect(url).toContain('page=2');
    expect(url).toContain('search=bob');
  });

  it('normalizes an error envelope into ApiError with status, message, and details', async () => {
    server.use(
      http.post(`${API_BASE_URL}/roles`, () =>
        HttpResponse.json(
          { success: false, error: { message: 'Validation failed', details: { fieldErrors: { name: ['Required'] } } } },
          { status: 400 }
        )
      )
    );

    await expect(callApiServices('/roles', 'post', false, {})).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'Validation failed',
      details: { fieldErrors: { name: ['Required'] } },
    });
  });

  it('normalizes a network failure into ApiError with status 0', async () => {
    server.use(http.get(`${API_BASE_URL}/thing`, () => HttpResponse.error()));

    const promise = callApiServices('/thing', 'get', false);

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ status: 0 });
  });
});
