import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  createTaskRequest,
  deleteTaskRequest,
  listTasksRequest,
  updateTaskRequest,
} from '../../services/endpoints/tasks.endpoints';
import { toPaginationMeta, type PaginationMeta } from '../../types/api';
import type { TaskPayload, TaskRow } from '../../types/task';
import { errorMessage, toFieldAwareError, type FieldAwareError } from '../thunkError';
import type { RootState } from '../index';

export const fetchTasks = createAsyncThunk<
  { items: TaskRow[]; meta: PaginationMeta },
  void,
  { state: RootState; rejectValue: string }
>('tasks/fetch', async (_, { getState, rejectWithValue }) => {
  const { page, limit, search } = getState().tasks;
  try {
    const { data, meta } = await listTasksRequest({ page, limit, search: search || undefined });
    return { items: data, meta: toPaginationMeta(meta, { page, limit, total: data.length }) };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const createTask = createAsyncThunk<TaskRow, TaskPayload, { rejectValue: FieldAwareError }>(
  'tasks/create',
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await createTaskRequest(payload);
      return data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const updateTask = createAsyncThunk<TaskRow, { id: string; payload: Partial<TaskPayload> }, { rejectValue: FieldAwareError }>(
  'tasks/update',
  async ({ id, payload }, { rejectWithValue }) => {
    try {
      const { data } = await updateTaskRequest(id, payload);
      return data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const deleteTask = createAsyncThunk<void, string, { rejectValue: string }>(
  'tasks/delete',
  async (id, { rejectWithValue }) => {
    try {
      await deleteTaskRequest(id);
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);
