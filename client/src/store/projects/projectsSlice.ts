import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { ProjectRow } from '../../types/project';
import { fetchAllProjects, fetchProjects } from './projectsThunks';

export interface ProjectsState {
  items: ProjectRow[];
  allItems: ProjectRow[];
  total: number;
  page: number;
  limit: number;
  search: string;
  status: ListStatus;
  error: string | null;
}

const initialState: ProjectsState = {
  items: [],
  allItems: [],
  total: 0,
  page: 1,
  limit: 10,
  search: '',
  status: 'idle',
  error: null,
};

const projectsSlice = createSlice({
  name: 'projects',
  initialState,
  reducers: {
    searchChanged(state, action: PayloadAction<string>) {
      state.search = action.payload;
      state.page = 1;
    },
    pageChanged(state, action: PayloadAction<{ page: number; limit: number }>) {
      state.page = action.payload.page;
      state.limit = action.payload.limit;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchProjects.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchProjects.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.items = action.payload.items;
        state.total = action.payload.meta.total;
      })
      .addCase(fetchProjects.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload ?? 'Could not load projects';
      })
      .addCase(fetchAllProjects.fulfilled, (state, action) => {
        state.allItems = action.payload;
      })
  },
});

export const { searchChanged, pageChanged } = projectsSlice.actions;
export const projectsReducer = projectsSlice.reducer;
