import { createSlice, isAnyOf, type PayloadAction } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { AssignedGroup, LifecycleTask, MyLifecycle } from '../../types/lifecycle';
import { completeLifecycleTask, deleteLifecycleFile, fetchAssignedTasks, fetchMyLifecycle, uploadLifecycleFile } from './lifecycleThunks';

/** My own onboarding/offboarding, and the tasks I do in other people's. */
export interface LifecycleState {
  mine: MyLifecycle[];
  mineStatus: ListStatus;
  assigned: AssignedGroup[];
  assignedStatus: ListStatus;
}

const initialState: LifecycleState = { mine: [], mineStatus: 'idle', assigned: [], assignedStatus: 'idle' };

function replaceTask(state: LifecycleState, task: LifecycleTask) {
  for (const p of state.mine) {
    const i = p.tasks.findIndex((t) => t.id === task.id);
    if (i >= 0) {
      if (p.tasks[i].status !== task.status && task.status === 'done') {
        p.progress.done += 1;
        p.progress.pending -= 1;
        if (p.tasks[i].overdue) p.progress.overdue -= 1;
      }
      p.tasks[i] = task;
    }
  }
  // Tasks for others are the pending ones: a finished one leaves the list.
  for (const g of state.assigned) {
    g.tasks = task.status === 'pending' ? g.tasks.map((t) => (t.id === task.id ? task : t)) : g.tasks.filter((t) => t.id !== task.id);
  }
  state.assigned = state.assigned.filter((g) => g.tasks.length > 0);
}

const lifecycleSlice = createSlice({
  name: 'lifecycle',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchMyLifecycle.pending, (state) => {
        if (state.mineStatus === 'idle') state.mineStatus = 'loading';
      })
      .addCase(fetchMyLifecycle.fulfilled, (state, action) => {
        state.mineStatus = 'succeeded';
        state.mine = action.payload;
      })
      .addCase(fetchMyLifecycle.rejected, (state) => {
        state.mineStatus = 'failed';
      })
      .addCase(fetchAssignedTasks.pending, (state) => {
        if (state.assignedStatus === 'idle') state.assignedStatus = 'loading';
      })
      .addCase(fetchAssignedTasks.fulfilled, (state, action) => {
        state.assignedStatus = 'succeeded';
        state.assigned = action.payload;
      })
      .addCase(fetchAssignedTasks.rejected, (state) => {
        state.assignedStatus = 'failed';
      })
      .addMatcher(isAnyOf(completeLifecycleTask.fulfilled, uploadLifecycleFile.fulfilled, deleteLifecycleFile.fulfilled), (state, action: PayloadAction<LifecycleTask>) =>
        replaceTask(state, action.payload)
      );
  },
});

export const lifecycleReducer = lifecycleSlice.reducer;
