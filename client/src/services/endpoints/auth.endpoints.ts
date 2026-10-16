import { callApiServices } from '../callApiServices';
import type { LoginResponse, MeResponse } from '../../types/auth';

export function loginRequest(email: string, password: string) {
  return callApiServices<LoginResponse>('/auth/login', 'post', false, { email, password });
}

export function meRequest() {
  return callApiServices<MeResponse>('/auth/me', 'get', true);
}

export function updateProfileRequest(formData: FormData) {
  return callApiServices<MeResponse>('/auth/update-profile', 'put', true, formData);
}

export function refreshRequest() {
  return callApiServices<{ accessToken: string }>('/auth/refresh', 'post', false);
}

export function logoutRequest() {
  return callApiServices<{ loggedOut: boolean }>('/auth/logout', 'post', true);
}

export function changePasswordRequest(oldPassword: string, newPassword: string) {
  return callApiServices<{ changed: boolean }>('/auth/change-password', 'post', true, { oldPassword, newPassword });
}

export function forgotPasswordRequest(email: string) {
  return callApiServices<{ resetToken: string | null }>('/auth/forgot-password', 'post', false, { email });
}

export function resetPasswordRequest(token: string, newPassword: string) {
  return callApiServices<{ reset: boolean }>('/auth/reset-password', 'post', false, { token, newPassword });
}
