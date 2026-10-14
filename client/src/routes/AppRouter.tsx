import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { FullPageLoader } from '../components/Loader/FullPageLoader';
import { ROUTES } from '../constants/routes';
import { AppLayout } from '../layouts/AppLayout';
import { AuthLayout } from '../layouts/AuthLayout';
import { MustChangePasswordGate } from './MustChangePasswordGate';
import { PermissionRoute } from './PermissionRoute';
import { PlanGate } from './PlanGate';
import { ProtectedRoute } from './ProtectedRoute';
import { RoleRoute } from './RoleRoute';

const LoginPage = lazy(() => import('../pages/auth/LoginPage'));
const ForgotPasswordPage = lazy(() => import('../pages/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('../pages/auth/ResetPasswordPage'));
const ChangePasswordPage = lazy(() => import('../pages/auth/ChangePasswordPage'));
const UnauthorizedPage = lazy(() => import('../pages/Unauthorized/UnauthorizedPage'));
const AdminUsersPage = lazy(() => import('../pages/superadmin/AdminUsersPage'));
const RolesPage = lazy(() => import('../pages/roles/RolesPage'));
const EmployeesPage = lazy(() => import('../pages/employees/EmployeesPage'));
const DocumentsPage = lazy(() => import('../pages/documents/DocumentsPage'));
const ProjectsPage = lazy(() => import('../pages/projects/ProjectsPage'));
const TasksPage = lazy(() => import('../pages/tasks/TasksPage'));
const HomePage = lazy(() => import('../pages/home/HomePage'));
const MePage = lazy(() => import('../pages/me/MePage'));
const LeaveApprovalsPage = lazy(() => import('../pages/leave/LeaveApprovalsPage'));
const LeaveTypesPage = lazy(() => import('../pages/leave/LeaveTypesPage'));
const HolidaysPage = lazy(() => import('../pages/holidays/HolidaysPage'));
const TeamAttendancePage = lazy(() => import('../pages/attendance/TeamAttendancePage'));
const AttendanceSettingsPage = lazy(() => import('../pages/attendance/AttendanceSettingsPage'));
const ExpensesAdminPage = lazy(() => import('../pages/expenses/ExpensesAdminPage'));
const LifecycleProcessesPage = lazy(() => import('../pages/peopleOps/LifecycleProcessesPage'));
const TemplatesPage = lazy(() => import('../pages/peopleOps/TemplatesPage'));
const DepartmentsPage = lazy(() => import('../pages/departments/DepartmentsPage'));
const ProfilePage = lazy(() => import('../pages/profile/Profile'));
const BillingPage = lazy(() => import('../pages/billing/BillingPage'));
const ExportsPage = lazy(() => import('../pages/exports/ExportsPage'));
const AuditLogsPage = lazy(() => import('../pages/auditLogs/AuditLogsPage'));
const PlansPage = lazy(() => import('../pages/plans/PlansPage'));

export function AppRouter() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route path={ROUTES.login} element={<LoginPage />} />
          <Route path={ROUTES.forgotPassword} element={<ForgotPasswordPage />} />
          <Route path={ROUTES.resetPassword} element={<ResetPasswordPage />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          {/* Outside the gate: this is the page the gate redirects to. */}
          <Route path={ROUTES.changePassword} element={<AuthLayout />}>
            <Route index element={<ChangePasswordPage />} />
          </Route>

          <Route element={<MustChangePasswordGate />}>
            {/* Outside PlanGate: this is where PlanGate sends an ORG_ADMIN without an active plan. */}
            <Route element={<RoleRoute allow={['ORG_ADMIN']} />}>
              <Route path={ROUTES.billing} element={<BillingPage />} />
            </Route>

            <Route element={<PlanGate />}>
              <Route element={<AppLayout />}>
                <Route path={ROUTES.unauthorized} element={<UnauthorizedPage />} />

                <Route element={<RoleRoute allow={['SUPER_ADMIN']} />}>
                  <Route path={ROUTES.adminUsers} element={<AdminUsersPage />} />
                </Route>

                <Route element={<RoleRoute allow={['ORG_ADMIN']} />}>
                  <Route path={ROUTES.roles} element={<RolesPage />} />
                  <Route path={ROUTES.leaveApprovals} element={<LeaveApprovalsPage />} />
                  <Route path={ROUTES.leaveTypes} element={<LeaveTypesPage />} />
                  <Route path={ROUTES.holidays} element={<HolidaysPage />} />
                  <Route path={ROUTES.teamAttendance} element={<TeamAttendancePage />} />
                  <Route path={ROUTES.attendanceSettings} element={<AttendanceSettingsPage />} />
                  <Route path={ROUTES.expenses} element={<ExpensesAdminPage />} />
                  {/* One page for both kinds; the key starts it afresh when switching. */}
                  <Route path={ROUTES.peopleOpsOnboarding} element={<LifecycleProcessesPage key="onboarding" kind="onboarding" />} />
                  <Route path={ROUTES.peopleOpsOffboarding} element={<LifecycleProcessesPage key="offboarding" kind="offboarding" />} />
                  <Route path={ROUTES.peopleOpsTemplates} element={<TemplatesPage />} />
                  <Route path={ROUTES.peopleOps} element={<Navigate to={ROUTES.peopleOpsOnboarding} replace />} />
                  <Route path={ROUTES.leaveManagement} element={<Navigate to={ROUTES.leaveApprovals} replace />} />
                </Route>

                <Route element={<PermissionRoute module="employees" />}>
                  <Route path={ROUTES.employees} element={<EmployeesPage />} />
                </Route>

                <Route element={<PermissionRoute module="documents" />}>
                  <Route path={ROUTES.documents} element={<DocumentsPage />} />
                </Route>

                <Route element={<PermissionRoute module="projects" />}>
                  <Route path={ROUTES.projects} element={<ProjectsPage />} />
                </Route>

                <Route element={<PermissionRoute module="tasks" />}>
                  <Route path={ROUTES.tasks} element={<TasksPage />} />
                </Route>

                {/* Every org member; the module counts on it follow the dashboard permission. */}
                <Route element={<RoleRoute allow={['ORG_ADMIN', 'ORG_USER']} />}>
                  <Route path={ROUTES.home} element={<HomePage />} />
                  <Route path={`${ROUTES.me}/:tab?`} element={<MePage />} />
                </Route>
                <Route path={ROUTES.dashboard} element={<Navigate to={ROUTES.home} replace />} />

                <Route element={<PermissionRoute module="departments" />}>
                  <Route path={ROUTES.departments} element={<DepartmentsPage />} />
                </Route>

                {/* Professional plan only: PermissionRoute checks the plan as well as the role. */}
                <Route element={<PermissionRoute module="exports" />}>
                  <Route path={ROUTES.exports} element={<ExportsPage />} />
                </Route>

                <Route element={<PermissionRoute module="auditLogs" />}>
                  <Route path={ROUTES.auditLogs} element={<AuditLogsPage />} />
                </Route>

                <Route element={<RoleRoute allow={['SUPER_ADMIN']} />}>
                  <Route path={ROUTES.plans} element={<PlansPage />} />
                </Route>

                <Route path={ROUTES.profile} element={<ProfilePage />} />

              </Route>
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to={ROUTES.login} replace />} />
      </Routes>
    </Suspense>
  );
}
