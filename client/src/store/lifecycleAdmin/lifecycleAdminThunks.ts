import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  addTaskRequest,
  cancelProcessRequest,
  completeProcessRequest,
  createTemplateRequest,
  deleteTemplateRequest,
  getProcessRequest,
  listProcessesRequest,
  listTemplatesRequest,
  makeDefaultTemplateRequest,
  skipTaskRequest,
  startOffboardingRequest,
  startOnboardingRequest,
  updateTaskRequest,
  updateTemplateRequest,
} from '../../services/endpoints/lifecycle.endpoints';
import { toPaginationMeta, type PaginationMeta } from '../../types/api';
import type {
  AddTaskPayload,
  AdminProcess,
  ChecklistTemplate,
  LifecycleKind,
  ProcessDetail,
  ProcessStatus,
  StartOffboardingPayload,
  StartOnboardingPayload,
  TemplatePayload,
  UpdateTaskPayload,
} from '../../types/lifecycle';
import { errorMessage, toFieldAwareError, type FieldAwareError } from '../thunkError';

export const PROCESS_PAGE_SIZE = 20;

export const fetchProcesses = createAsyncThunk<
  { items: AdminProcess[]; meta: PaginationMeta },
  { kind: LifecycleKind; status?: ProcessStatus; page?: number },
  { rejectValue: string }
>('lifecycleAdmin/fetchProcesses', async ({ kind, status, page = 1 }, { rejectWithValue }) => {
  try {
    const { data, meta } = await listProcessesRequest({ kind, status, page, limit: PROCESS_PAGE_SIZE });
    return { items: data, meta: toPaginationMeta(meta, { page, limit: PROCESS_PAGE_SIZE, total: data.length }) };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/** Every process-changing call returns the full process; the slice keeps it open. */
function processThunk<Arg>(type: string, call: (arg: Arg) => Promise<{ data: ProcessDetail }>) {
  return createAsyncThunk<ProcessDetail, Arg, { rejectValue: FieldAwareError }>(type, async (arg, { rejectWithValue }) => {
    try {
      return (await call(arg)).data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  });
}

export const openProcess = processThunk('lifecycleAdmin/open', (id: string) => getProcessRequest(id));
export const startOnboarding = processThunk('lifecycleAdmin/startOnboarding', (payload: StartOnboardingPayload) => startOnboardingRequest(payload));
export const startOffboarding = processThunk('lifecycleAdmin/startOffboarding', (payload: StartOffboardingPayload) => startOffboardingRequest(payload));
export const completeProcess = processThunk('lifecycleAdmin/complete', ({ id, skipRemaining }: { id: string; skipRemaining: boolean }) =>
  completeProcessRequest(id, skipRemaining)
);
export const cancelProcess = processThunk('lifecycleAdmin/cancel', ({ id, reason }: { id: string; reason: string }) => cancelProcessRequest(id, reason));
export const addProcessTask = processThunk('lifecycleAdmin/addTask', ({ processId, payload }: { processId: string; payload: AddTaskPayload }) =>
  addTaskRequest(processId, payload)
);
export const updateProcessTask = processThunk('lifecycleAdmin/updateTask', ({ taskId, payload }: { taskId: string; payload: UpdateTaskPayload }) =>
  updateTaskRequest(taskId, payload)
);
export const skipProcessTask = processThunk('lifecycleAdmin/skipTask', ({ taskId, reason }: { taskId: string; reason: string }) =>
  skipTaskRequest(taskId, reason)
);

export const fetchTemplates = createAsyncThunk<ChecklistTemplate[], void, { rejectValue: string }>(
  'lifecycleAdmin/fetchTemplates',
  async (_, { rejectWithValue }) => {
    try {
      return (await listTemplatesRequest()).data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const saveTemplate = createAsyncThunk<ChecklistTemplate, { id: string | null; payload: TemplatePayload }, { rejectValue: FieldAwareError }>(
  'lifecycleAdmin/saveTemplate',
  async ({ id, payload }, { rejectWithValue }) => {
    try {
      if (id) {
        const { kind: _kind, ...rest } = payload;
        return (await updateTemplateRequest(id, rest)).data;
      }
      return (await createTemplateRequest(payload)).data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const deleteTemplate = createAsyncThunk<string, string, { rejectValue: string }>('lifecycleAdmin/deleteTemplate', async (id, { rejectWithValue }) => {
  try {
    await deleteTemplateRequest(id);
    return id;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/** The old default changes too, so the list is reloaded after. */
export const makeDefaultTemplate = createAsyncThunk<ChecklistTemplate, string, { rejectValue: string }>(
  'lifecycleAdmin/makeDefault',
  async (id, { rejectWithValue }) => {
    try {
      return (await makeDefaultTemplateRequest(id)).data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);
