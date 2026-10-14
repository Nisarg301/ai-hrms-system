import axios, { type AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { setAccessToken } from './tokenStore';
import type { ApiSuccessBody } from '../types/api';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';

const REFRESH_ENDPOINT = '/auth/refresh';

/** withCredentials is required so the httpOnly refresh cookie is sent to /auth/*. */
export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

let onAuthFailure: (() => void) | null = null;

/**
 * Registered by the app shell so the interceptor can clear the session without
 * importing the store — that would be circular
 * (store -> thunks -> callApiServices -> api).
 */
export function setOnAuthFailure(callback: (() => void) | null): void {
  onAuthFailure = callback;
}

let onPlanExpired: (() => void) | null = null;

/**
 * Registered by the app shell (same reason as setOnAuthFailure): called when the
 * API answers 402 because the organization's plan ran out mid-session.
 */
export function setOnPlanExpired(callback: (() => void) | null): void {
  onPlanExpired = callback;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

/**
 * Shared in-flight refresh. Concurrent 401s await the same promise so N failures
 * trigger one refresh, not N.
 */
let refreshPromise: Promise<string> | null = null;

async function performRefresh(): Promise<string> {
  // The one place allowed to bypass callApiServices: calling it here would
  // recurse back through this interceptor.
  const response = await api.post<ApiSuccessBody<{ accessToken: string }>>(REFRESH_ENDPOINT);
  const token = response.data.data.accessToken;
  setAccessToken(token);
  return token;
}

function refreshOnce(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const status = error.response?.status;

    if (status === 402) {
      onPlanExpired?.();
      return Promise.reject(error);
    }

    const isRefreshCall = original?.url === REFRESH_ENDPOINT;
    if (status !== 401 || !original || original._retried || isRefreshCall) {
      return Promise.reject(error);
    }

    original._retried = true;

    try {
      const token = await refreshOnce();
      original.headers.set('Authorization', `Bearer ${token}`);
      return await api.request(original);
    } catch {
      setAccessToken(null);
      onAuthFailure?.();
      return Promise.reject(error);
    }
  }
);
