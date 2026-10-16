import { createAsyncThunk } from '@reduxjs/toolkit';
import { getMyIntroductionRequest, updateMyIntroductionRequest } from '../../services/endpoints/me.endpoints';
import { listIntroductionsRequest } from '../../services/endpoints/people.endpoints';
import type { Introduction, IntroductionCard } from '../../types/people';
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
