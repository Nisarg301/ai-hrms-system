import { createAsyncThunk } from '@reduxjs/toolkit';
import { createHolidayRequest, deleteHolidayRequest, listHolidaysRequest, updateHolidayRequest } from '../../services/endpoints/holidays.endpoints';
import type { Holiday, HolidayPayload } from '../../types/holiday';
import { errorMessage, toFieldAwareError, type FieldAwareError } from '../thunkError';

export const fetchHolidays = createAsyncThunk<Holiday[], number, { rejectValue: string }>(
  'holidays/fetch',
  async (year, { rejectWithValue }) => {
    try {
      const { data } = await listHolidaysRequest(year);
      return data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const createHoliday = createAsyncThunk<Holiday, HolidayPayload, { rejectValue: FieldAwareError }>(
  'holidays/create',
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await createHolidayRequest(payload);
      return data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const updateHoliday = createAsyncThunk<Holiday, { id: string; payload: HolidayPayload }, { rejectValue: FieldAwareError }>(
  'holidays/update',
  async ({ id, payload }, { rejectWithValue }) => {
    try {
      const { data } = await updateHolidayRequest(id, payload);
      return data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const deleteHoliday = createAsyncThunk<string, string, { rejectValue: string }>('holidays/delete', async (id, { rejectWithValue }) => {
  try {
    await deleteHolidayRequest(id);
    return id;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});
