import { createSlice } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { Person } from '../../types/people';
import type { MyTeam } from '../../types/team';
import { fetchMyTeam, fetchPeople } from './teamThunks';

export interface TeamState {
  team: MyTeam | null;
  teamStatus: ListStatus;
  teamError: string | null;
  people: Person[];
  peopleStatus: ListStatus;
  peopleError: string | null;
}

const initialState: TeamState = {
  team: null,
  teamStatus: 'idle',
  teamError: null,
  people: [],
  peopleStatus: 'idle',
  peopleError: null,
};

const teamSlice = createSlice({
  name: 'team',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchMyTeam.pending, (state) => {
        state.teamStatus = 'loading';
        state.teamError = null;
      })
      .addCase(fetchMyTeam.fulfilled, (state, action) => {
        state.teamStatus = 'succeeded';
        state.team = action.payload;
      })
      .addCase(fetchMyTeam.rejected, (state, action) => {
        state.teamStatus = 'failed';
        state.teamError = action.payload ?? 'Could not load your team';
      })
      .addCase(fetchPeople.pending, (state) => {
        state.peopleStatus = 'loading';
        state.peopleError = null;
      })
      .addCase(fetchPeople.fulfilled, (state, action) => {
        state.peopleStatus = 'succeeded';
        state.people = action.payload;
      })
      .addCase(fetchPeople.rejected, (state, action) => {
        state.peopleStatus = 'failed';
        state.peopleError = action.payload ?? 'Could not load people';
      });
  },
});

export const teamReducer = teamSlice.reducer;
