import { createSlice } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { HomeSummary } from '../../types/home';
import { deleteAnnouncement, fetchHomeSummary } from './homeThunks';

export interface HomeState {
  summary: HomeSummary | null;
  status: ListStatus;
  error: string | null;
}

const initialState: HomeState = {
  summary: null,
  status: 'idle',
  error: null,
};

const homeSlice = createSlice({
  name: 'home',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchHomeSummary.pending, (state) => {
        // A refresh keeps showing the current summary rather than flashing skeletons.
        if (!state.summary) state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchHomeSummary.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.summary = action.payload;
      })
      .addCase(fetchHomeSummary.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload ?? 'Could not load your home page';
      })
      .addCase(deleteAnnouncement.fulfilled, (state, action) => {
        if (state.summary) {
          state.summary.announcements = state.summary.announcements.filter((a) => a.id !== action.payload);
        }
      });
  },
});

export const homeReducer = homeSlice.reducer;
