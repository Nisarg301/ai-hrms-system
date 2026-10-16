import { createSlice } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { AppNotification } from '../../types/notification';
import { fetchNotifications, fetchUnreadCount, markAllNotificationsRead, markNotificationRead } from './notificationsThunks';

export interface NotificationsState {
  items: AppNotification[];
  unreadCount: number;
  status: ListStatus;
  error: string | null;
}

const initialState: NotificationsState = { items: [], unreadCount: 0, status: 'idle', error: null };

const notificationsSlice = createSlice({
  name: 'notifications',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchNotifications.pending, (state) => {
        if (state.status === 'idle') state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchNotifications.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.items = action.payload.items;
        state.unreadCount = action.payload.unreadCount;
      })
      .addCase(fetchNotifications.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload ?? 'Could not load notifications';
      })
      .addCase(fetchUnreadCount.fulfilled, (state, action) => {
        state.unreadCount = action.payload;
      })
      .addCase(markNotificationRead.pending, (state, action) => {
        const n = state.items.find((x) => x.id === action.meta.arg);
        if (n && !n.read) {
          n.read = true;
          state.unreadCount = Math.max(0, state.unreadCount - 1);
        }
      })
      .addCase(markAllNotificationsRead.pending, (state) => {
        state.items.forEach((n) => {
          n.read = true;
        });
        state.unreadCount = 0;
      });
  },
});

export const notificationsReducer = notificationsSlice.reducer;
