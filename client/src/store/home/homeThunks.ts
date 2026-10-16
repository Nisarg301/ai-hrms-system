import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  createAnnouncementRequest,
  deleteAnnouncementRequest,
  updateAnnouncementRequest,
} from '../../services/endpoints/announcements.endpoints';
import { getHomeSummaryRequest } from '../../services/endpoints/home.endpoints';
import type { Announcement, AnnouncementPayload } from '../../types/announcement';
import type { HomeSummary } from '../../types/home';
import { errorMessage, toFieldAwareError, type FieldAwareError } from '../thunkError';

export const fetchHomeSummary = createAsyncThunk<HomeSummary, void, { rejectValue: string }>(
  'home/fetchSummary',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await getHomeSummaryRequest();
      return data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

// Announcements live in the Home summary; after a change the caller refreshes it.
export const createAnnouncement = createAsyncThunk<Announcement, AnnouncementPayload, { rejectValue: FieldAwareError }>(
  'home/createAnnouncement',
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await createAnnouncementRequest(payload);
      return data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const updateAnnouncement = createAsyncThunk<
  Announcement,
  { id: string; payload: AnnouncementPayload },
  { rejectValue: FieldAwareError }
>('home/updateAnnouncement', async ({ id, payload }, { rejectWithValue }) => {
  try {
    const { data } = await updateAnnouncementRequest(id, payload);
    return data;
  } catch (err) {
    return rejectWithValue(toFieldAwareError(err));
  }
});

export const deleteAnnouncement = createAsyncThunk<string, string, { rejectValue: string }>(
  'home/deleteAnnouncement',
  async (id, { rejectWithValue }) => {
    try {
      await deleteAnnouncementRequest(id);
      return id;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);
