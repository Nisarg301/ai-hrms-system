import { createSlice, isAnyOf, type PayloadAction } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { AdminProcess, ChecklistTemplate, LifecycleTask, ProcessDetail } from '../../types/lifecycle';
import { completeLifecycleTask, deleteLifecycleFile, uploadLifecycleFile } from '../lifecycle/lifecycleThunks';
import {
  addProcessTask,
  cancelProcess,
  completeProcess,
  deleteTemplate,
  fetchProcesses,
  fetchTemplates,
  makeDefaultTemplate,
  openProcess,
  saveTemplate,
  skipProcessTask,
  startOffboarding,
  startOnboarding,
  updateProcessTask,
} from './lifecycleAdminThunks';

/** ORG_ADMIN: onboarding/offboarding processes, the one open, and the checklist templates. */
export interface LifecycleAdminState {
  processes: AdminProcess[];
  processesTotal: number;
  processesStatus: ListStatus;
  processesError: string | null;
  current: ProcessDetail | null;
  templates: ChecklistTemplate[];
  templatesStatus: ListStatus;
  templatesError: string | null;
}

const initialState: LifecycleAdminState = {
  processes: [],
  processesTotal: 0,
  processesStatus: 'idle',
  processesError: null,
  current: null,
  templates: [],
  templatesStatus: 'idle',
  templatesError: null,
};

const lifecycleAdminSlice = createSlice({
  name: 'lifecycleAdmin',
  initialState,
  reducers: {
    closeProcess(state) {
      state.current = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchProcesses.pending, (state) => {
        state.processesStatus = 'loading';
        state.processesError = null;
      })
      .addCase(fetchProcesses.fulfilled, (state, action) => {
        state.processesStatus = 'succeeded';
        state.processes = action.payload.items;
        state.processesTotal = action.payload.meta.total;
      })
      .addCase(fetchProcesses.rejected, (state, action) => {
        state.processesStatus = 'failed';
        state.processesError = action.payload ?? 'Could not load the list';
      })
      .addCase(fetchTemplates.pending, (state) => {
        if (state.templatesStatus === 'idle') state.templatesStatus = 'loading';
        state.templatesError = null;
      })
      .addCase(fetchTemplates.fulfilled, (state, action) => {
        state.templatesStatus = 'succeeded';
        state.templates = action.payload;
      })
      .addCase(fetchTemplates.rejected, (state, action) => {
        state.templatesStatus = 'failed';
        state.templatesError = action.payload ?? 'Could not load the templates';
      })
      .addCase(saveTemplate.fulfilled, (state, action) => {
        const i = state.templates.findIndex((t) => t.id === action.payload.id);
        if (i >= 0) state.templates[i] = action.payload;
        else state.templates.push(action.payload);
      })
      .addCase(deleteTemplate.fulfilled, (state, action) => {
        state.templates = state.templates.filter((t) => t.id !== action.payload);
      })
      .addCase(makeDefaultTemplate.fulfilled, (state, action) => {
        state.templates = state.templates.map((t) =>
          t.kind === action.payload.kind ? { ...t, isDefault: t.id === action.payload.id } : t
        );
      })
      .addMatcher(
        isAnyOf(
          openProcess.fulfilled,
          startOnboarding.fulfilled,
          startOffboarding.fulfilled,
          completeProcess.fulfilled,
          cancelProcess.fulfilled,
          addProcessTask.fulfilled,
          updateProcessTask.fulfilled,
          skipProcessTask.fulfilled
        ),
        (state, action: PayloadAction<ProcessDetail>) => {
          state.current = action.payload;
          const { tasks: _tasks, ...row } = action.payload;
          state.processes = state.processes.map((p) => (p.id === row.id ? row : p));
        }
      )
      // Completing or attaching files from the shared task panel.
      .addMatcher(
        isAnyOf(completeLifecycleTask.fulfilled, uploadLifecycleFile.fulfilled, deleteLifecycleFile.fulfilled),
        (state, action: PayloadAction<LifecycleTask>) => {
          if (!state.current) return;
          state.current.tasks = state.current.tasks.map((t) => (t.id === action.payload.id ? action.payload : t));
        }
      );
  },
});

export const { closeProcess } = lifecycleAdminSlice.actions;
export const lifecycleAdminReducer = lifecycleAdminSlice.reducer;
