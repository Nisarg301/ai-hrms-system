import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  createProjectRequest,
  deleteProjectRequest,
  listProjectsRequest,
  updateProjectRequest,
} from '../../services/endpoints/projects.endpoints';
import { toPaginationMeta, type PaginationMeta } from '../../types/api';
import type { ProjectPayload, ProjectRow } from '../../types/project';
import { errorMessage, toFieldAwareError, type FieldAwareError } from '../thunkError';
import type { RootState } from '../index';

export const fetchProjects = createAsyncThunk<
  { items: ProjectRow[]; meta: PaginationMeta },
  void,
  { state: RootState; rejectValue: string }
>('projects/fetch', async (_, { getState, rejectWithValue }) => {
  const { page, limit, search } = getState().projects;
  try {
    const { data, meta } = await listProjectsRequest({ page, limit, search: search || undefined });
    return { items: data, meta: toPaginationMeta(meta, { page, limit, total: data.length }) };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchAllProjects = createAsyncThunk<ProjectRow[], void, { rejectValue: string }>(
  'projects/fetchAll',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await listProjectsRequest({ page: 1, limit: 999999 });
      return data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const createProject = createAsyncThunk<ProjectRow, ProjectPayload, { rejectValue: FieldAwareError }>(
  'projects/create',
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await createProjectRequest(payload);
      return data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const updateProject = createAsyncThunk<ProjectRow, { id: string; payload: Partial<ProjectPayload> }, { rejectValue: FieldAwareError }>(
  'projects/update',
  async ({ id, payload }, { rejectWithValue }) => {
    try {
      const { data } = await updateProjectRequest(id, payload);
      return data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const deleteProject = createAsyncThunk<void, string, { rejectValue: string }>(
  'projects/delete',
  async (id, { rejectWithValue }) => {
    try {
      await deleteProjectRequest(id);
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);
