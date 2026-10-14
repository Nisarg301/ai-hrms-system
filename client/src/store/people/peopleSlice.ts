import { createSlice } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { Introduction, IntroductionCard } from '../../types/people';
import { fetchIntroductions, fetchMyIntroduction, saveMyIntroduction } from './peopleThunks';

export interface PeopleState {
  introductions: IntroductionCard[];
  introductionsStatus: ListStatus;
  introductionsError: string | null;
  myIntroduction: Introduction | null;
  myIntroductionStatus: ListStatus;
}

const initialState: PeopleState = {
  introductions: [],
  introductionsStatus: 'idle',
  introductionsError: null,
  myIntroduction: null,
  myIntroductionStatus: 'idle',
};

const peopleSlice = createSlice({
  name: 'people',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchIntroductions.pending, (state) => {
        state.introductionsStatus = 'loading';
        state.introductionsError = null;
      })
      .addCase(fetchIntroductions.fulfilled, (state, action) => {
        state.introductionsStatus = 'succeeded';
        state.introductions = action.payload;
      })
      .addCase(fetchIntroductions.rejected, (state, action) => {
        state.introductionsStatus = 'failed';
        state.introductionsError = action.payload ?? 'Could not load introductions';
      })
      .addCase(fetchMyIntroduction.pending, (state) => {
        state.myIntroductionStatus = 'loading';
      })
      .addCase(fetchMyIntroduction.fulfilled, (state, action) => {
        state.myIntroductionStatus = 'succeeded';
        state.myIntroduction = action.payload;
      })
      .addCase(fetchMyIntroduction.rejected, (state) => {
        state.myIntroductionStatus = 'failed';
      })
      .addCase(saveMyIntroduction.fulfilled, (state, action) => {
        state.myIntroduction = action.payload;
        state.myIntroductionStatus = 'succeeded';
      });
  },
});

export const peopleReducer = peopleSlice.reducer;
