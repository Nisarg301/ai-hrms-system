import { createAsyncThunk } from '@reduxjs/toolkit';
import { leaveErrorMessage } from '../../components/ApplyLeaveDrawer/ApplyLeaveDrawer';
import { getMyDetailsRequest, getMyIntroductionRequest, updateMyDetailsRequest, updateMyIntroductionRequest } from '../../services/endpoints/me.endpoints';
import { listIntroductionsRequest } from '../../services/endpoints/people.endpoints';
import type { Introduction, IntroductionCard, MyDetails } from '../../types/people';
import { errorMessage, toFieldAwareError, type FieldAwareError } from '../thunkError';

export const fetchIntroductions = createAsyncThunk<IntroductionCard[], void, { rejectValue: string }>(
  'people/fetchIntroductions',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await listIntroductionsRequest();
      return data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const fetchMyIntroduction = createAsyncThunk<Introduction, void, { rejectValue: string }>(
  'people/fetchMyIntroduction',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await getMyIntroductionRequest();
      return data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const saveMyIntroduction = createAsyncThunk<Introduction, Introduction, { rejectValue: FieldAwareError }>(
  'people/saveMyIntroduction',
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await updateMyIntroductionRequest(payload);
      return data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

/** My own details (the date of birth), kept in the store so the Profile assistant can reload them after a change. */
export const fetchMyDetails = createAsyncThunk<MyDetails, void, { rejectValue: string }>('people/fetchMyDetails', async (_, { rejectWithValue }) => {
  try {
    const { data } = await getMyDetailsRequest();
    return data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/** Rejects with the API's own reason ("A date of birth can't be in the future"). */
export const saveMyDetails = createAsyncThunk<MyDetails, MyDetails, { rejectValue: string }>('people/saveMyDetails', async (payload, { rejectWithValue }) => {
  try {
    const { data } = await updateMyDetailsRequest(payload);
    return data;
  } catch (err) {
    return rejectWithValue(leaveErrorMessage(err));
  }
});
