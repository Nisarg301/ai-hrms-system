import type { RootState } from '../index';

export const selectMyTeam = (state: RootState) => state.team.team;
export const selectMyTeamStatus = (state: RootState) => state.team.teamStatus;
export const selectMyTeamError = (state: RootState) => state.team.teamError;
export const selectPeople = (state: RootState) => state.team.people;
export const selectPeopleStatus = (state: RootState) => state.team.peopleStatus;
export const selectPeopleError = (state: RootState) => state.team.peopleError;
