import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  getUnreadCountRequest,
  listNotificationsRequest,
  markAllNotificationsReadRequest,
  markNotificationReadRequest,
} from '../../services/endpoints/notifications.endpoints';
import type { AppNotification } from '../../types/notification';
import { errorMessage } from '../thunkError';

export const fetchNotifications = createAsyncThunk<{ items: AppNotification[]; unreadCount: number }, void, { rejectValue: string }>(
  'notifications/fetch',
  async (_, { rejectWithValue }) => {
    try {
      return (await listNotificationsRequest()).data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const fetchUnreadCount = createAsyncThunk<number, void, { rejectValue: string }>('notifications/fetchUnread', async (_, { rejectWithValue }) => {
  try {
    return (await getUnreadCountRequest()).data.count;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/** The slice marks it read straight away; a failure isn't worth undoing for a bell. */
export const markNotificationRead = createAsyncThunk<void, string, { rejectValue: string }>('notifications/markRead', async (id, { rejectWithValue }) => {
  try {
    await markNotificationReadRequest(id);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const markAllNotificationsRead = createAsyncThunk<void, void, { rejectValue: string }>('notifications/markAllRead', async (_, { rejectWithValue }) => {
  try {
    await markAllNotificationsReadRequest();
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});
