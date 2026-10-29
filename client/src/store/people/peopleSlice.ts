import { createSlice } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { Introduction, IntroductionCard, MyDetails } from '../../types/people';
import { fetchIntroductions, fetchMyDetails, fetchMyIntroduction, saveMyDetails, saveMyIntroduction } from './peopleThunks';

export interface PeopleState {
  introductions: IntroductionCard[];
  introductionsStatus: ListStatus;
  introductionsError: string | null;
  myIntroduction: Introduction | null;
  myIntroductionStatus: ListStatus;
  myDetails: MyDetails | null;
  myDetailsStatus: ListStatus;
}

const initialState: PeopleState = {
  introductions: [],
  introductionsStatus: 'idle',
  introductionsError: null,
  myIntroduction: null,
  myIntroductionStatus: 'idle',
  myDetails: null,
  myDetailsStatus: 'idle',
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
      })
      .addCase(fetchMyDetails.pending, (state) => {
        state.myDetailsStatus = 'loading';
      })
      .addCase(fetchMyDetails.fulfilled, (state, action) => {
        state.myDetailsStatus = 'succeeded';
        state.myDetails = action.payload;
      })
      .addCase(fetchMyDetails.rejected, (state) => {
        state.myDetailsStatus = 'failed';
      })
      .addCase(saveMyDetails.fulfilled, (state, action) => {
        state.myDetails = action.payload;
        state.myDetailsStatus = 'succeeded';
      });
  },
});

export const peopleReducer = peopleSlice.reducer;
