import { createSlice, isAnyOf, type PayloadAction } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { Goal, GoalDetail, MyReviewRow, ReviewDetail, ReviewToWriteRow } from '../../types/performance';
import {
  checkInGoal,
  createGoal,
  deleteGoal,
  fetchMyGoals,
  fetchMyReviews,
  fetchReviewsToWrite,
  fetchTeamGoals,
  openGoal,
  openReview,
  updateGoal,
  writeReviewPart,
} from './performanceThunks';

/** My goals and my direct reports'; my reviews and those I write; the goal or review open. */
export interface PerformanceState {
  myGoals: Goal[];
  myGoalsStatus: ListStatus;
  myGoalsError: string | null;
  teamGoals: Goal[];
  teamGoalsStatus: ListStatus;
  current: GoalDetail | null;
  myReviews: MyReviewRow[];
  myReviewsStatus: ListStatus;
  toWrite: ReviewToWriteRow[];
  toWriteStatus: ListStatus;
  currentReview: ReviewDetail | null;
}

const initialState: PerformanceState = {
  myGoals: [],
  myGoalsStatus: 'idle',
  myGoalsError: null,
  teamGoals: [],
  teamGoalsStatus: 'idle',
  current: null,
  myReviews: [],
  myReviewsStatus: 'idle',
  toWrite: [],
  toWriteStatus: 'idle',
  currentReview: null,
};

/** Keeps whichever list holds the goal in step with it. */
function upsert(list: Goal[], goal: Goal): Goal[] {
  return list.some((g) => g.id === goal.id) ? list.map((g) => (g.id === goal.id ? goal : g)) : [...list, goal];
}

const performanceSlice = createSlice({
  name: 'performance',
  initialState,
  reducers: {
    closeGoal(state) {
      state.current = null;
    },
    closeReview(state) {
      state.currentReview = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchMyGoals.pending, (state) => {
        if (state.myGoalsStatus === 'idle') state.myGoalsStatus = 'loading';
        state.myGoalsError = null;
      })
      .addCase(fetchMyGoals.fulfilled, (state, action) => {
        state.myGoalsStatus = 'succeeded';
        state.myGoals = action.payload;
      })
      .addCase(fetchMyGoals.rejected, (state, action) => {
        state.myGoalsStatus = 'failed';
        state.myGoalsError = action.payload ?? 'Could not load your goals';
      })
      .addCase(fetchTeamGoals.pending, (state) => {
        if (state.teamGoalsStatus === 'idle') state.teamGoalsStatus = 'loading';
      })
      .addCase(fetchTeamGoals.fulfilled, (state, action) => {
        state.teamGoalsStatus = 'succeeded';
        state.teamGoals = action.payload;
      })
      .addCase(fetchTeamGoals.rejected, (state) => {
        state.teamGoalsStatus = 'failed';
      })
      .addCase(fetchMyReviews.pending, (state) => {
        if (state.myReviewsStatus === 'idle') state.myReviewsStatus = 'loading';
      })
      .addCase(fetchMyReviews.fulfilled, (state, action) => {
        state.myReviewsStatus = 'succeeded';
        state.myReviews = action.payload;
      })
      .addCase(fetchMyReviews.rejected, (state) => {
        state.myReviewsStatus = 'failed';
      })
      .addCase(fetchReviewsToWrite.pending, (state) => {
        if (state.toWriteStatus === 'idle') state.toWriteStatus = 'loading';
      })
      .addCase(fetchReviewsToWrite.fulfilled, (state, action) => {
        state.toWriteStatus = 'succeeded';
        state.toWrite = action.payload;
      })
      .addCase(fetchReviewsToWrite.rejected, (state) => {
        state.toWriteStatus = 'failed';
      })
      .addCase(openReview.fulfilled, (state, action) => {
        state.currentReview = action.payload;
      })
      .addCase(writeReviewPart.fulfilled, (state, action) => {
        state.currentReview = action.payload;
        const r = action.payload;
        state.myReviews = state.myReviews.map((row) => (row.id === r.id ? { ...row, selfStatus: r.selfStatus, released: r.released } : row));
        state.toWrite = state.toWrite.map((row) =>
          row.id === r.id ? { ...row, selfStatus: r.selfStatus, managerStatus: r.managerStatus ?? row.managerStatus, released: r.released } : row
        );
      })
      .addCase(deleteGoal.fulfilled, (state, action) => {
        state.myGoals = state.myGoals.filter((g) => g.id !== action.payload);
        state.teamGoals = state.teamGoals.filter((g) => g.id !== action.payload);
        if (state.current?.id === action.payload) state.current = null;
      })
      .addMatcher(isAnyOf(openGoal.fulfilled, createGoal.fulfilled, updateGoal.fulfilled, checkInGoal.fulfilled), (state, action: PayloadAction<GoalDetail>) => {
        state.current = action.payload;
        const { relation, canDelete: _canDelete, checkIns: _checkIns, ...goal } = action.payload;
        if (relation === 'owner') state.myGoals = upsert(state.myGoals, goal);
        // "My team" is my direct reports; an admin looking at someone else's goal doesn't add it there.
        else if (relation === 'manager') state.teamGoals = upsert(state.teamGoals, goal);
      });
  },
});

export const { closeGoal, closeReview } = performanceSlice.actions;
export const performanceReducer = performanceSlice.reducer;
