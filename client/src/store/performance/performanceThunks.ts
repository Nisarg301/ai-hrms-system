import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  checkInRequest,
  createGoalRequest,
  deleteGoalRequest,
  getGoalRequest,
  listMyGoalsRequest,
  listTeamGoalsRequest,
  updateGoalRequest,
  getReviewRequest,
  listMyReviewsRequest,
  listReviewsToWriteRequest,
  writeReviewPartRequest,
} from '../../services/endpoints/performance.endpoints';
import type {
  CheckInPayload,
  Goal,
  GoalDetail,
  GoalPayload,
  MyReviewRow,
  ReviewDetail,
  ReviewPartName,
  ReviewPartPayload,
  ReviewToWriteRow,
} from '../../types/performance';
import { errorMessage, toFieldAwareError, type FieldAwareError } from '../thunkError';

export const fetchMyGoals = createAsyncThunk<Goal[], void, { rejectValue: string }>('performance/fetchMyGoals', async (_, { rejectWithValue }) => {
  try {
    return (await listMyGoalsRequest()).data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchTeamGoals = createAsyncThunk<Goal[], void, { rejectValue: string }>('performance/fetchTeamGoals', async (_, { rejectWithValue }) => {
  try {
    return (await listTeamGoalsRequest()).data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/** Every goal-changing call returns the goal with its check-ins; the slice keeps it open. */
function goalThunk<Arg>(type: string, call: (arg: Arg) => Promise<{ data: GoalDetail }>) {
  return createAsyncThunk<GoalDetail, Arg, { rejectValue: FieldAwareError }>(type, async (arg, { rejectWithValue }) => {
    try {
      return (await call(arg)).data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  });
}

export const openGoal = goalThunk('performance/openGoal', (id: string) => getGoalRequest(id));
export const createGoal = goalThunk('performance/createGoal', (payload: GoalPayload) => createGoalRequest(payload));
export const updateGoal = goalThunk('performance/updateGoal', ({ id, payload }: { id: string; payload: Omit<GoalPayload, 'ownerId'> }) =>
  updateGoalRequest(id, payload)
);
export const checkInGoal = goalThunk('performance/checkIn', ({ id, payload }: { id: string; payload: CheckInPayload }) => checkInRequest(id, payload));

export const deleteGoal = createAsyncThunk<string, string, { rejectValue: string }>('performance/deleteGoal', async (id, { rejectWithValue }) => {
  try {
    await deleteGoalRequest(id);
    return id;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

// ---------------------------------------------------------------- reviews

export const fetchMyReviews = createAsyncThunk<MyReviewRow[], void, { rejectValue: string }>('performance/fetchMyReviews', async (_, { rejectWithValue }) => {
  try {
    return (await listMyReviewsRequest()).data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchReviewsToWrite = createAsyncThunk<ReviewToWriteRow[], void, { rejectValue: string }>(
  'performance/fetchReviewsToWrite',
  async (_, { rejectWithValue }) => {
    try {
      return (await listReviewsToWriteRequest()).data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const openReview = createAsyncThunk<ReviewDetail, string, { rejectValue: string }>('performance/openReview', async (id, { rejectWithValue }) => {
  try {
    return (await getReviewRequest(id)).data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const writeReviewPart = createAsyncThunk<
  ReviewDetail,
  { id: string; part: ReviewPartName; payload: ReviewPartPayload; submit: boolean },
  { rejectValue: FieldAwareError }
>('performance/writeReviewPart', async ({ id, part, payload, submit }, { rejectWithValue }) => {
  try {
    return (await writeReviewPartRequest(id, part, payload, submit)).data;
  } catch (err) {
    return rejectWithValue(toFieldAwareError(err));
  }
});
