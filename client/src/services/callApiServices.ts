import type {
  AxiosError,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios';

import { api } from './api';
import { getAccessToken } from './tokenStore';
import {
  ApiError,
  type ApiErrorBody,
  type ApiSuccessBody,
} from '../types/api';

export type HttpMethod =
  | 'get'
  | 'post'
  | 'put'
  | 'patch'
  | 'delete';

type ApiServiceResponse<T> = {
  data: T;
  meta?: Record<string, unknown>;
  headers: AxiosResponse['headers'];
};

export async function callApiServices<T>(
  endpoint: string,
  method: HttpMethod,
  requiresToken: boolean,
  payload?: unknown,
  responseType?: AxiosRequestConfig['responseType']
): Promise<ApiServiceResponse<T>> {
  const config: AxiosRequestConfig = {};

  if (responseType) {
    config.responseType = responseType;
  }

  if (requiresToken) {
    const token = getAccessToken();

    if (token) {
      config.headers = {
        Authorization: `Bearer ${token}`,
      };
    }
  }

  try {
    const response =
      method === 'get' || method === 'delete'
        ? await api[method]<ApiSuccessBody<T>>(
          endpoint,
          {
            ...config,
            params: payload,
          }
        )
        : await api[method]<ApiSuccessBody<T>>(
          endpoint,
          payload,
          config
        );

    /*
     * File/blob response:
     *
     * response.data IS the Blob.
     *
     * Don't try:
     * response.data.data
     */
    if (responseType === 'blob') {
      return {
        data: response.data as unknown as T,
        headers: response.headers,
      };
    }

    /*
     * Normal JSON response:
     *
     * {
     *   data: {...},
     *   meta: {...}
     * }
     */
    return {
      data: (response.data as ApiSuccessBody<T>).data,
      meta: (response.data as ApiSuccessBody<T>).meta,
      headers: response.headers,
    };
  } catch (err) {
    const axiosError = err as AxiosError<ApiErrorBody>;

    const status = axiosError.response?.status ?? 0;
    const body = axiosError.response?.data;

    const message =
      body?.error?.message ??
      axiosError.message ??
      'Request failed';

    throw new ApiError(
      status,
      message,
      body?.error?.details
    );
  }
}