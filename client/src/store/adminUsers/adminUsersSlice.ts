import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { AdminUserRow, OrganizationRow } from '../../types/adminUser';
import { fetchAdminUsers, fetchOrganizations, inviteOrgAdmin } from './adminUsersThunks';

export interface AdminUsersState {
  items: AdminUserRow[];
  total: number;
  page: number;
  limit: number;
  search: string;
  status: ListStatus;
  error: string | null;
  organizations: OrganizationRow[];
  /** Shown once in a modal after an invite; never persisted. */
  tempPassword: string | null;
}

const initialState: AdminUsersState = {
  items: [],
  total: 0,
  page: 1,
  limit: 10,
  search: '',
  status: 'idle',
  error: null,
  organizations: [],
  tempPassword: null,
};

const adminUsersSlice = createSlice({
  name: 'adminUsers',
  initialState,
  reducers: {
    searchChanged(state, action: PayloadAction<string>) {
      state.search = action.payload;
      // A new query invalidates the current page offset.
      state.page = 1;
    },
    pageChanged(state, action: PayloadAction<{ page: number; limit: number }>) {
      state.page = action.payload.page;
      state.limit = action.payload.limit;
    },
    tempPasswordCleared(state) {
      state.tempPassword = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAdminUsers.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchAdminUsers.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.items = action.payload.items;
        state.total = action.payload.meta.total;
      })
      .addCase(fetchAdminUsers.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload ?? 'Could not load admin users';
      })
      .addCase(inviteOrgAdmin.fulfilled, (state, action) => {
        state.tempPassword = action.payload.temp_password;
      })
      .addCase(fetchOrganizations.fulfilled, (state, action) => {
        state.organizations = action.payload;
      });
  },
});

export const { searchChanged, pageChanged, tempPasswordCleared } = adminUsersSlice.actions;
export const adminUsersReducer = adminUsersSlice.reducer;
