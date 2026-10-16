import { createAsyncThunk } from '@reduxjs/toolkit';
import { getMyTeamRequest } from '../../services/endpoints/me.endpoints';
import { listPeopleRequest } from '../../services/endpoints/people.endpoints';
import type { Person } from '../../types/people';
import type { MyTeam } from '../../types/team';
import { errorMessage } from '../thunkError';

export const fetchMyTeam = createAsyncThunk<MyTeam, void, { rejectValue: string }>('team/fetchMyTeam', async (_, { rejectWithValue }) => {
  try {
    const { data } = await getMyTeamRequest();
    return data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/** The organization's active members (for my profile's manager/department, and pickers). */
export const fetchPeople = createAsyncThunk<Person[], void, { rejectValue: string }>('team/fetchPeople', async (_, { rejectWithValue }) => {
  try {
    const { data } = await listPeopleRequest();
    return data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});
