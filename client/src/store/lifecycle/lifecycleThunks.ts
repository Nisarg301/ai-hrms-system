import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  completeTaskRequest,
  deleteTaskFileRequest,
  getAssignedTasksRequest,
  getMyLifecycleRequest,
  uploadTaskFileRequest,
} from '../../services/endpoints/lifecycle.endpoints';
import type { AssignedGroup, CompleteTaskPayload, LifecycleTask, MyLifecycle } from '../../types/lifecycle';
import { errorMessage, toFieldAwareError, type FieldAwareError } from '../thunkError';

export const fetchMyLifecycle = createAsyncThunk<MyLifecycle[], void, { rejectValue: string }>('lifecycle/fetchMine', async (_, { rejectWithValue }) => {
  try {
    return (await getMyLifecycleRequest()).data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchAssignedTasks = createAsyncThunk<AssignedGroup[], void, { rejectValue: string }>(
  'lifecycle/fetchAssigned',
  async (_, { rejectWithValue }) => {
    try {
      return (await getAssignedTasksRequest()).data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/** Every task change returns the task; the slice puts it back wherever it's shown. */
function taskThunk<Arg>(type: string, call: (arg: Arg) => Promise<{ data: LifecycleTask }>) {
  return createAsyncThunk<LifecycleTask, Arg, { rejectValue: FieldAwareError }>(type, async (arg, { rejectWithValue }) => {
    try {
      return (await call(arg)).data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  });
}

export const completeLifecycleTask = taskThunk('lifecycle/completeTask', ({ taskId, payload }: { taskId: string; payload: CompleteTaskPayload }) =>
  completeTaskRequest(taskId, payload)
);
export const uploadLifecycleFile = taskThunk('lifecycle/uploadFile', ({ taskId, file }: { taskId: string; file: File }) => uploadTaskFileRequest(taskId, file));
export const deleteLifecycleFile = taskThunk('lifecycle/deleteFile', ({ taskId, fileId }: { taskId: string; fileId: string }) =>
  deleteTaskFileRequest(taskId, fileId)
);
