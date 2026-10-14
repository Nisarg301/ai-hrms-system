import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { AuthUser } from '../../types/auth';
import { ORG_PLAN_EXPIRED_MESSAGE } from '../../constants/plans';
import { bootstrapSession, changePassword, forgotPassword, login, logout, planExpiredSignOut, refreshCurrentUser, updateProfile } from './authThunks';

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthState {
  user: AuthUser | null;
  status: AuthStatus;
  /** True once the boot sequence has settled, so the router can stop showing the loader. */
  bootstrapped: boolean;
  error: string | null;
  /** Returned by forgot-password because email is stubbed in the backend. */
  resetToken: string | null;
}

const initialState: AuthState = {
  user: null,
  status: 'idle',
  bootstrapped: false,
  error: null,
  resetToken: null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    sessionCleared(state) {
      state.user = null;
      state.status = 'unauthenticated';
      state.error = null;
    },
    mustChangePasswordCleared(state) {
      if (state.user) {
        state.user.mustChangePassword = false;
      }
    },
    resetTokenCleared(state) {
      state.resetToken = null;
    },
    /**
     * The API answered 402 mid-session: the plan ran out since /auth/me. Marking
     * it inactive lets PlanGate take over (billing for ORG_ADMIN, sign-out for ORG_USER).
     */
    planLapsed(state) {
      if (state.user?.subscription) {
        state.user.subscription.active = false;
        state.user.subscription.modules = [];
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action: PayloadAction<AuthUser>) => {
        state.status = 'authenticated';
        state.user = action.payload;
        state.error = null;
      })
      .addCase(login.rejected, (state, action) => {
        state.status = 'unauthenticated';
        state.user = null;
        state.error = action.payload ?? 'Login failed';
      })
      .addCase(bootstrapSession.pending, (state) => {
        state.status = 'loading';
      })
      .addCase(bootstrapSession.fulfilled, (state, action: PayloadAction<AuthUser>) => {
        state.status = 'authenticated';
        state.user = action.payload;
        state.bootstrapped = true;
      })
      .addCase(bootstrapSession.rejected, (state) => {
        state.status = 'unauthenticated';
        state.user = null;
        state.bootstrapped = true;
      })
      .addCase(logout.fulfilled, (state) => {
        state.status = 'unauthenticated';
        state.user = null;
      })
      .addCase(changePassword.fulfilled, (state) => {
        if (state.user) {
          state.user.mustChangePassword = false;
        }
      })
      .addCase(forgotPassword.fulfilled, (state, action: PayloadAction<string | null>) => {
        state.resetToken = action.payload;
      })
      .addCase(updateProfile.fulfilled, (state, action: PayloadAction<AuthUser>) => {
        state.user = action.payload;
      })
      .addCase(refreshCurrentUser.fulfilled, (state, action: PayloadAction<AuthUser>) => {
        state.user = action.payload;
      })
      .addCase(planExpiredSignOut.fulfilled, (state) => {
        state.user = null;
        state.status = 'unauthenticated';
        state.error = ORG_PLAN_EXPIRED_MESSAGE;
      });
  },
});

export const { sessionCleared, mustChangePasswordCleared, resetTokenCleared, planLapsed } = authSlice.actions;
export const authReducer = authSlice.reducer;
