import { createSlice } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { Holiday } from '../../types/holiday';
import { deleteHoliday, fetchHolidays } from './holidaysThunks';

export interface HolidaysState {
  year: number | null;
  items: Holiday[];
  status: ListStatus;
  error: string | null;
}

const initialState: HolidaysState = { year: null, items: [], status: 'idle', error: null };

const holidaysSlice = createSlice({
  name: 'holidays',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchHolidays.pending, (state, action) => {
        state.year = action.meta.arg;
        state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchHolidays.fulfilled, (state, action) => {
        // Ignore a slow answer for a year the user has since moved away from.
        if (state.year !== action.meta.arg) return;
        state.status = 'succeeded';
        state.items = action.payload;
      })
      .addCase(fetchHolidays.rejected, (state, action) => {
        if (state.year !== action.meta.arg) return;
        state.status = 'failed';
        state.error = action.payload ?? 'Could not load holidays';
      })
      .addCase(deleteHoliday.fulfilled, (state, action) => {
        state.items = state.items.filter((h) => h.id !== action.payload);
      });
  },
});

export const holidaysReducer = holidaysSlice.reducer;
