import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  disableAdminUserRequest,
  inviteOrgAdminRequest,
  listAdminUsersRequest,
  listOrganizationsRequest,
} from '../../services/endpoints/superAdmin.endpoints';
import { toPaginationMeta, type PaginationMeta } from '../../types/api';
import { errorMessage, toFieldAwareError, type FieldAwareError } from '../thunkError';
import type { AdminUserRow, InviteOrgAdminPayload, InviteResult, OrganizationRow } from '../../types/adminUser';
import type { RootState } from '../index';

export const fetchAdminUsers = createAsyncThunk<
  { items: AdminUserRow[]; meta: PaginationMeta },
  void,
  { state: RootState; rejectValue: string }
>('adminUsers/fetch', async (_, { getState, rejectWithValue }) => {
  const { page, limit, search } = getState().adminUsers;
  try {
    const { data, meta } = await listAdminUsersRequest({ page, limit, search: search || undefined });
    return { items: data, meta: toPaginationMeta(meta, { page, limit, total: data.length }) };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const inviteOrgAdmin = createAsyncThunk<InviteResult, InviteOrgAdminPayload, { rejectValue: FieldAwareError }>(
  'adminUsers/invite',
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await inviteOrgAdminRequest(payload);
      return data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const disableAdminUser = createAsyncThunk<void, string, { rejectValue: string }>(
  'adminUsers/disable',
  async (id, { rejectWithValue }) => {
    try {
      await disableAdminUserRequest(id);
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const fetchOrganizations = createAsyncThunk<OrganizationRow[], { search?: string } | void, { rejectValue: string }>(
  'adminUsers/fetchOrganizations',
  async (args, { rejectWithValue }) => {
    try {
      const { data } = await listOrganizationsRequest({ page: 1, limit: 100, search: args?.search || undefined });
      return data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);
