import {
  AuditOutlined,
  CalendarOutlined,
  CarryOutOutlined,
  CheckSquareOutlined,
  ClockCircleOutlined,
  CreditCardOutlined,
  DownloadOutlined,
  FileTextOutlined,
  GiftOutlined,
  HomeOutlined,
  KeyOutlined,
  LogoutOutlined,
  ProfileOutlined,
  RocketOutlined,
  ProjectOutlined,
  ScheduleOutlined,
  SettingOutlined,
  SolutionOutlined,
  TeamOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import type { PlanFeature } from '../constants/modules';
import { ROUTES } from '../constants/routes';
import type { UserRoleName } from '../types/auth';
import type { ModuleName, PermissionAction } from '../types/role';

export interface NavItem {
  key: string;
  label: string;
  to: string;
  icon: ReactNode;
  /** A group: shown as a submenu, `to` being the prefix its pages share. */
  children?: NavItem[];
}

interface ModuleNavItem extends NavItem {
  module: ModuleName;
}

// Feature-module nav entries, shown only when the user can read the module.
const MODULE_NAV: ModuleNavItem[] = [
  { key: 'employees', label: 'Employees', to: ROUTES.employees, icon: <SolutionOutlined />, module: 'employees' },
  { key: 'documents', label: 'Documents', to: ROUTES.documents, icon: <FileTextOutlined />, module: 'documents' },
  { key: 'projects', label: 'Projects', to: ROUTES.projects, icon: <ProjectOutlined />, module: 'projects' },
  { key: 'departments', label: 'Departments', to: ROUTES.departments, icon: <TeamOutlined />, module: 'departments' },
  { key: 'tasks', label: 'Tasks', to: ROUTES.tasks, icon: <CheckSquareOutlined />, module: 'tasks' },
  // Professional plan only (can() checks the plan's modules).
  { key: 'exports', label: 'Exports', to: ROUTES.exports, icon: <DownloadOutlined />, module: 'exports' },
  { key: 'auditLogs', label: 'Audit Logs', to: ROUTES.auditLogs, icon: <AuditOutlined />, module: 'auditLogs' },
];

// Every org member has Home and Me, whatever their role's permission matrix.
const HOME: NavItem = { key: 'home', label: 'Home', to: ROUTES.home, icon: <HomeOutlined /> };
const ME: NavItem = { key: 'me', label: 'Me', to: ROUTES.me, icon: <UserOutlined /> };

// ORG_ADMIN only. The Approvals badge (leave, attendance and expense requests) is added by the layout.
const LEAVE_MANAGEMENT: NavItem = {
  key: 'leave-management',
  label: 'Approvals & leave',
  to: ROUTES.leaveManagement,
  icon: <CalendarOutlined />,
  children: [
    { key: 'leave-approvals', label: 'Approvals', to: ROUTES.leaveApprovals, icon: <CarryOutOutlined /> },
    { key: 'team-attendance', label: 'Team attendance', to: ROUTES.teamAttendance, icon: <ClockCircleOutlined /> },
    { key: 'leave-types', label: 'Leave types', to: ROUTES.leaveTypes, icon: <ScheduleOutlined /> },
    { key: 'holidays', label: 'Holidays', to: ROUTES.holidays, icon: <GiftOutlined /> },
    { key: 'attendance-settings', label: 'Attendance settings', to: ROUTES.attendanceSettings, icon: <SettingOutlined /> },
  ],
};

// ORG_ADMIN only: everyone's claims, paying them, spending and categories.
const EXPENSES: NavItem = { key: 'expenses', label: 'Expenses', to: ROUTES.expenses, icon: <WalletOutlined /> };

// ORG_ADMIN only: joining and leaving checklists.
const PEOPLE_OPS: NavItem = {
  key: 'people-ops',
  label: 'People ops',
  to: ROUTES.peopleOps,
  icon: <RocketOutlined />,
  children: [
    { key: 'onboarding', label: 'Onboarding', to: ROUTES.peopleOpsOnboarding, icon: <RocketOutlined /> },
    { key: 'offboarding', label: 'Offboarding', to: ROUTES.peopleOpsOffboarding, icon: <LogoutOutlined /> },
    { key: 'checklist-templates', label: 'Templates', to: ROUTES.peopleOpsTemplates, icon: <ProfileOutlined /> },
  ],
};

/**
 * The nav a user may see: role-based management screens plus any feature modules
 * they can read. Mirrors the guards — the nav hides the doors, the guard closes
 * them, the backend locks them.
 */
export function navItems(
  role: UserRoleName,
  can: (module: ModuleName, action: PermissionAction) => boolean,
  hasFeature: (feature: PlanFeature) => boolean = () => true
): NavItem[] {
  const roleItems: NavItem[] = (() => {
    switch (role) {
      case 'SUPER_ADMIN':
        return [
          { key: 'admin-users', label: 'Admin Users', to: ROUTES.adminUsers, icon: <TeamOutlined /> },
          { key: 'plans', label: 'Plans', to: ROUTES.plans, icon: <CreditCardOutlined /> },
        ];
      case 'ORG_ADMIN':
        return [HOME, ME, LEAVE_MANAGEMENT, ...(hasFeature('onboarding') ? [PEOPLE_OPS] : []), ...(hasFeature('expenses') ? [EXPENSES] : []), { key: 'roles', label: 'Roles', to: ROUTES.roles, icon: <KeyOutlined /> }];
      case 'ORG_USER':
        return [HOME, ME];
      default:
        return [];
    }
  })();

  const moduleItems: NavItem[] = MODULE_NAV.filter((m) => can(m.module, 'read')).map(({ module: _module, ...item }) => item);
  return [...roleItems, ...moduleItems];
}
