import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { adminUsersReducer } from './adminUsers/adminUsersSlice';
import { auditLogsReducer } from './auditLogs/auditLogsSlice';
import { attendanceReducer } from './attendance/attendanceSlice';
import { attendanceAdminReducer } from './attendanceAdmin/attendanceAdminSlice';
import { authReducer } from './auth/authSlice';
import { departmentsReducer } from './departments/departmentsSlice';
import { documentsReducer } from './documents/documentsSlice';
import { employeesReducer } from './employees/employeesSlice';
import { expensesReducer } from './expenses/expensesSlice';
import { expensesAdminReducer } from './expensesAdmin/expensesAdminSlice';
import { lifecycleReducer } from './lifecycle/lifecycleSlice';
import { lifecycleAdminReducer } from './lifecycleAdmin/lifecycleAdminSlice';
import { performanceReducer } from './performance/performanceSlice';
import { holidaysReducer } from './holidays/holidaysSlice';
import { homeReducer } from './home/homeSlice';
import { leaveReducer } from './leave/leaveSlice';
import { leaveAdminReducer } from './leaveAdmin/leaveAdminSlice';
import { notificationsReducer } from './notifications/notificationsSlice';
import { peopleReducer } from './people/peopleSlice';
import { postsReducer } from './posts/postsSlice';
import { projectsReducer } from './projects/projectsSlice';
import { rolesReducer } from './roles/rolesSlice';
import { tasksReducer } from './tasks/tasksSlice';
import { teamReducer } from './team/teamSlice';

// Exported so tests can build a store with the exact app shape (see
// src/test/makeTestStore.ts) instead of hand-listing slices that drift.
export const rootReducer = combineReducers({
  auth: authReducer,
  adminUsers: adminUsersReducer,
  documents: documentsReducer,
  employees: employeesReducer,
  projects: projectsReducer,
  roles: rolesReducer,
  tasks: tasksReducer,
  departments: departmentsReducer,
  auditLogs: auditLogsReducer,
  home: homeReducer,
  posts: postsReducer,
  people: peopleReducer,
  leave: leaveReducer,
  holidays: holidaysReducer,
  team: teamReducer,
  leaveAdmin: leaveAdminReducer,
  attendance: attendanceReducer,
  attendanceAdmin: attendanceAdminReducer,
  notifications: notificationsReducer,
  expenses: expensesReducer,
  expensesAdmin: expensesAdminReducer,
  lifecycle: lifecycleReducer,
  lifecycleAdmin: lifecycleAdminReducer,
  performance: performanceReducer,
});

export const store = configureStore({ reducer: rootReducer });

export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = typeof store.dispatch;
