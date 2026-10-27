import { randomBytes } from 'crypto';
import { env } from '../config/env';
import { ApiCall, ApiClient, ApiPage, UploadedFile } from './types';

/**
 * Sent on every internal call so the audit log can tell a change was made through the
 * assistant. Random per process, so a browser cannot claim it.
 */
export const AI_AGENT_TOKEN = randomBytes(16).toString('hex');
export const AI_AGENT_HEADER = 'x-ai-agent';

/** The API refused the call; `message` is the API's own, shown to the user as-is. */
export class ApiCallError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
    this.name = 'ApiCallError';
  }
}

function apiBase(): string {
  return env.AI_INTERNAL_API_BASE ?? `http://127.0.0.1:${env.PORT}/api/v1`;
}

/** Drops null, undefined and '' so optional filters are simply left out. */
export function toQueryString(query?: Record<string, unknown>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Calls the existing REST API as the signed-in user, so authenticate, org scoping, plan
 * checks, RBAC, validation and auditing all run exactly as for a click in the UI.
 */
export function createApiClient(token: string, fetchImpl: typeof fetch = fetch): ApiClient {
  async function request<T>({ method, path, query, body, attachFile }: ApiCall, file?: UploadedFile): Promise<{ data: T; meta: ApiPage<T>['meta'] }> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, [AI_AGENT_HEADER]: AI_AGENT_TOKEN };
    let payload: string | FormData | undefined;
    if (attachFile && file) {
      // The fields and the file, as the page's own form sends them; fetch sets the multipart boundary.
      payload = multipartBody(body, file);
    } else {
      headers['Content-Type'] = 'application/json';
      payload = body === undefined ? undefined : JSON.stringify(body);
    }
    const res = await fetchImpl(`${apiBase()}${path}${toQueryString(query)}`, { method, headers, body: payload });
    const json = (await res.json().catch(() => null)) as
      | { data?: T; meta?: ApiPage<T>['meta']; error?: { message?: string; details?: unknown } }
      | null;
    if (!res.ok) {
      throw new ApiCallError(res.status, json?.error?.message ?? `Request failed (${res.status})`, json?.error?.details);
    }
    return { data: json?.data as T, meta: json?.meta ?? {} };
  }
  return {
    get: async (path, query) => (await request<never>({ method: 'GET', path, query })).data,
    page: (path, query) => request({ method: 'GET', path, query }),
    send: async (call, file) => (await request<never>(call, file)).data,
  };
}

/** A body's fields as text parts, plus the file under `file`: what the upload middleware reads. */
export function multipartBody(body: unknown, file: UploadedFile): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries((body ?? {}) as Record<string, unknown>)) {
    if (value !== undefined && value !== null) form.append(key, String(value));
  }
  form.append('file', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
  return form;
}

/** Keys that must never reach the model or the stored conversation. */
const SECRET_KEYS = ['temp_password'] as const;

/** Splits secrets (the new employee's temporary password) off an API result. */
export function takeSecrets(result: unknown): { clean: unknown; secrets: { label: string; value: string }[] } {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return { clean: result, secrets: [] };
  const clean: Record<string, unknown> = { ...(result as Record<string, unknown>) };
  const secrets: { label: string; value: string }[] = [];
  for (const key of SECRET_KEYS) {
    if (typeof clean[key] === 'string') {
      secrets.push({ label: 'Temporary password', value: clean[key] as string });
      delete clean[key];
    }
  }
  return { clean, secrets };
}
