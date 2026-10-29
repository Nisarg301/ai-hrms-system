import type { RootState } from '../index';

export const selectIntroductions = (state: RootState) => state.people.introductions;
export const selectIntroductionsStatus = (state: RootState) => state.people.introductionsStatus;
export const selectIntroductionsError = (state: RootState) => state.people.introductionsError;
export const selectMyIntroduction = (state: RootState) => state.people.myIntroduction;
export const selectMyIntroductionStatus = (state: RootState) => state.people.myIntroductionStatus;
export const selectMyDetails = (state: RootState) => state.people.myDetails;
export const selectMyDetailsStatus = (state: RootState) => state.people.myDetailsStatus;
