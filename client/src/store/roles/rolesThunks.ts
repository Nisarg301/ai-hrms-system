import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  createRoleRequest,
  deleteRoleRequest,
  listRolesRequest,
  updateRoleRequest,
  type RolePayload,
} from '../../services/endpoints/roles.endpoints';
import { toPaginationMeta, type PaginationMeta } from '../../types/api';
import { errorMessage } from '../thunkError';
import type { Role } from '../../types/role';
import type { RootState } from '../index';

export const fetchRoles = createAsyncThunk<
  { items: Role[]; meta: PaginationMeta },
  void,
  { state: RootState; rejectValue: string }
>('roles/fetch', async (_, { getState, rejectWithValue }) => {
  const { page, limit, search } = getState().roles;
  try {
    const { data, meta } = await listRolesRequest({ page, limit, search: search || undefined });
    return { items: data, meta: toPaginationMeta(meta, { page, limit, total: data.length }) };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const createRole = createAsyncThunk<Role, RolePayload, { rejectValue: string }>(
  'roles/create',
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await createRoleRequest(payload);
      return data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const updateRole = createAsyncThunk<Role, { id: string; payload: Partial<RolePayload> }, { rejectValue: string }>(
  'roles/update',
  async ({ id, payload }, { rejectWithValue }) => {
    try {
      const { data } = await updateRoleRequest(id, payload);
      return data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const deleteRole = createAsyncThunk<void, string, { rejectValue: string }>(
  'roles/delete',
  async (id, { rejectWithValue }) => {
    try {
      await deleteRoleRequest(id);
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);
