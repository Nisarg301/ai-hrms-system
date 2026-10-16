import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  changePasswordRequest,
  forgotPasswordRequest,
  loginRequest,
  logoutRequest,
  meRequest,
  refreshRequest,
  resetPasswordRequest,
  updateProfileRequest,
} from '../../services/endpoints/auth.endpoints';
import { getAccessToken, setAccessToken } from '../../services/tokenStore';
import { errorMessage, toFieldAwareError, type FieldAwareError } from '../thunkError';
import type { AuthUser } from '../../types/auth';

export const login = createAsyncThunk<AuthUser, { email: string; password: string }, { rejectValue: string }>(
  'auth/login',
  async ({ email, password }, { rejectWithValue }) => {
    try {
      const { data } = await loginRequest(email, password);
      setAccessToken(data.accessToken);
      return data.user;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/**
 * Restores a session after a page reload. The access token is persisted in
 * sessionStorage, so if it is present we go straight to /auth/me — no /refresh.
 * If that token has expired, /me returns 401 and the axios interceptor refreshes
 * once and retries, so /refresh fires only when the token is actually expired.
 * If no token is stored (first load, or after the tab closed) we refresh first.
 */
export const bootstrapSession = createAsyncThunk<AuthUser, void, { rejectValue: string }>(
  'auth/bootstrapSession',
  async (_, { rejectWithValue }) => {
    try {
      if (!getAccessToken()) {
        const { data: refreshed } = await refreshRequest();
        setAccessToken(refreshed.accessToken);
      }
      const { data } = await meRequest();
      return data.user;
    } catch (err) {
      setAccessToken(null);
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const updateProfile = createAsyncThunk<AuthUser, { formData: FormData }, { rejectValue: FieldAwareError }>(
  'auth/updateProfile',
  async ({ formData }, { rejectWithValue }) => {
    try {
      const { data } = await updateProfileRequest(formData);
      return data.user;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

/**
 * Re-reads the signed-in user (e.g. after a payment changes the plan). Unlike
 * bootstrapSession it leaves `status` alone, so ProtectedRoute never flashes to
 * the login screen while it runs.
 */
export const refreshCurrentUser = createAsyncThunk<AuthUser, void, { rejectValue: string }>(
  'auth/refreshCurrentUser',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await meRequest();
      return data.user;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/**
 * Signs out an ORG_USER whose organization has no active plan. The slice then
 * shows ORG_PLAN_EXPIRED_MESSAGE on the login page.
 */
export const planExpiredSignOut = createAsyncThunk<void, void>('auth/planExpiredSignOut', async () => {
  try {
    await logoutRequest();
  } catch {
    // Signing out locally is what matters; the server session expires on its own.
  } finally {
    setAccessToken(null);
  }
});

export const logout = createAsyncThunk<void, void>('auth/logout', async () => {
  try {
    await logoutRequest();
  } finally {
    // Clear locally even if the server call fails — the user asked to leave.
    localStorage.removeItem('theme_color');
    localStorage.removeItem('theme_mode');
    setAccessToken(null);
  }
});

export const changePassword = createAsyncThunk<
  void,
  { oldPassword: string; newPassword: string },
  { rejectValue: string }
>('auth/changePassword', async ({ oldPassword, newPassword }, { rejectWithValue }) => {
  try {
    await changePasswordRequest(oldPassword, newPassword);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const forgotPassword = createAsyncThunk<string | null, { email: string }, { rejectValue: string }>(
  'auth/forgotPassword',
  async ({ email }, { rejectWithValue }) => {
    try {
      const { data } = await forgotPasswordRequest(email);
      return data.resetToken;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const resetPassword = createAsyncThunk<void, { token: string; newPassword: string }, { rejectValue: string }>(
  'auth/resetPassword',
  async ({ token, newPassword }, { rejectWithValue }) => {
    try {
      await resetPasswordRequest(token, newPassword);
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);
