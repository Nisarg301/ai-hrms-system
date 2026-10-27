import {
  BgColorsOutlined,
  CheckOutlined,
  CreditCardOutlined,
  DesktopOutlined,
  DownOutlined,
  LockOutlined,
  LogoutOutlined,
  MoonOutlined,
  ProfileOutlined,
  SunOutlined,
} from '@ant-design/icons';
import { Avatar, Badge, Layout, Menu, Dropdown, Space } from 'antd';
import type { MenuProps } from 'antd';
import { useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AiAssistant } from '../components/AiAssistant/AiAssistant';
import { BrandMark } from '../components/BrandMark/BrandMark';
import { avatarColors, initialOf } from '../components/PersonAvatar/PersonAvatar';
import { NotificationBell } from '../components/NotificationBell/NotificationBell';
import { PeopleSearch } from '../components/PeopleSearch/PeopleSearch';
import { PlanExpiryBanner } from '../components/PlanExpiryBanner/PlanExpiryBanner';
import { ROUTES } from '../constants/routes';
import { useAppDispatch, useAppSelector } from '../hooks/store';
import { useCan } from '../hooks/useCan';
import { useHasFeature } from '../hooks/useHasFeature';
import { useTheme } from '../hooks/useTheme';
import { navItems, type NavItem } from '../routes/navItems';
import { selectAuthUser } from '../store/auth/authSelectors';
import { logout } from '../store/auth/authThunks';
import { selectAttendancePendingCounts } from '../store/attendanceAdmin/attendanceAdminSelectors';
import { fetchAttendancePendingCounts } from '../store/attendanceAdmin/attendanceAdminThunks';
import { selectExpensePendingCount } from '../store/expensesAdmin/expensesAdminSelectors';
import { fetchExpensePendingCount } from '../store/expensesAdmin/expensesAdminThunks';
import { selectPendingCount } from '../store/leaveAdmin/leaveAdminSelectors';
import { fetchPendingCount } from '../store/leaveAdmin/leaveAdminThunks';

export function AppLayout() {
  const user = useAppSelector(selectAuthUser);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const can = useCan();
  const { themeMode, setThemeMode, themeColor, setThemeColor, isDarkMode, tokens: currentTokens } = useTheme();

  const hasFeature = useHasFeature();
  const items = user ? navItems(user.role, can, hasFeature) : [];
  const leavePending = useAppSelector(selectPendingCount);
  const attendancePending = useAppSelector(selectAttendancePendingCounts);
  const expensesPending = useAppSelector(selectExpensePendingCount);
  const pendingCount = (leavePending ?? 0) + (attendancePending?.total ?? 0) + (expensesPending ?? 0);
  const isOrgAdmin = user?.role === 'ORG_ADMIN';
  const isOrgMember = isOrgAdmin || user?.role === 'ORG_USER';

  // The Approvals badge: loaded once here, then refreshed by the Approvals page and after each decision.
  useEffect(() => {
    if (isOrgAdmin) {
      void dispatch(fetchPendingCount());
      void dispatch(fetchAttendancePendingCounts());
      void dispatch(fetchExpensePendingCount());
    }
  }, [isOrgAdmin, dispatch]);

  const leaves = items.flatMap((i) => i.children ?? [i]);
  const selectedKeys = leaves.filter((i) => location.pathname.startsWith(i.to)).map((i) => i.key);
  const openGroups = items.filter((i) => i.children && location.pathname.startsWith(i.to)).map((i) => i.key);

  const toMenuItem = (item: NavItem): NonNullable<MenuProps['items']>[number] =>
    item.children
      ? { key: item.key, icon: item.icon, label: item.label, children: item.children.map(toMenuItem) }
      : {
          key: item.key,
          icon: item.icon,
          label:
            item.key === 'leave-approvals' && pendingCount ? (
              <Link to={item.to} className="flex items-center justify-between">
                {item.label}
                <Badge count={pendingCount} size="small" aria-label={`${pendingCount} pending`} />
              </Link>
            ) : (
              <Link to={item.to}>{item.label}</Link>
            ),
        };
  // The same letter as every other avatar of this person (PersonAvatar).
  const initial = user ? initialOf(user.name) : '?';

  const onSignOut = async () => {
    await dispatch(logout());
    navigate(ROUTES.login, { replace: true });
  };

  const userDropdown: MenuProps['items'] = [
    {
      key: 'profile',
      label: 'Profile',
      icon: <ProfileOutlined />,
      onClick: () => navigate(ROUTES.profile),
    },
    // Only the ORG_ADMIN manages the organization's plan.
    ...(user?.role === 'ORG_ADMIN'
      ? [
          { type: 'divider' as const },
          {
            key: 'billing',
            label: 'Billing & plan',
            icon: <CreditCardOutlined />,
            onClick: () => navigate(ROUTES.billing),
          },
        ]
      : []),
    {
      type: 'divider',
    },
    {
      key: 'change-password',
      label: 'Change Password',
      icon: <LockOutlined />,
      onClick: () => navigate(ROUTES.changePassword),
    },
    {
      type: 'divider',
    },
    {
      key: 'display-mode',
      label: 'Display mode',
      icon: <SunOutlined />,
      children: [
        {
          key: 'light',
          label: (
            <div className="flex items-center justify-between gap-4">
              <span>Light</span>
              {themeMode === 'light' && <CheckOutlined className="text-xs" />}
            </div>
          ),
          icon: <SunOutlined />,
          onClick: () => setThemeMode('light'),
        },
        {
          type: 'divider',
        },
        {
          key: 'dark',
          label: (
            <div className="flex items-center justify-between gap-4">
              <span>Dark</span>
              {themeMode === 'dark' && <CheckOutlined className="text-xs" />}
            </div>
          ),
          icon: <MoonOutlined />,
          onClick: () => setThemeMode('dark'),
        },
        {
          type: 'divider',
        },
        {
          key: 'system',
          label: (
            <div className="flex items-center justify-between gap-4">
              <span>System</span>
              {themeMode === 'system' && <CheckOutlined className="text-xs" />}
            </div>
          ),
          icon: <DesktopOutlined />,
          onClick: () => setThemeMode('system'),
        },
      ],
    },
    {
      type: 'divider',
    },
    {
      key: 'theme-color',
      label: 'Theme color',
      icon: <BgColorsOutlined />,
      children: [
        {
          key: 'purple',
          label: (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 rounded" style={{ backgroundColor: '#7c3aed' }} />
                <span>Purple</span>
              </div>
              {themeColor === 'purple' && <CheckOutlined className="text-xs" />}
            </div>
          ),
          onClick: () => setThemeColor('purple'),
        },
        {
          type: 'divider',
        },
        {
          key: 'blue',
          label: (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 rounded" style={{ backgroundColor: '#1677ff' }} />
                <span>Blue</span>
              </div>
              {themeColor === 'blue' && <CheckOutlined className="text-xs" />}
            </div>
          ),
          onClick: () => setThemeColor('blue'),
        },
        {
          type: 'divider',
        },
        {
          key: 'pink',
          label: (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 rounded" style={{ backgroundColor: '#ec4899' }} />
                <span>Pink</span>
              </div>
              {themeColor === 'pink' && <CheckOutlined className="text-xs" />}
            </div>
          ),
          onClick: () => setThemeColor('pink'),
        },
        {
          type: 'divider',
        },
        {
          key: 'green',
          label: (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 rounded" style={{ backgroundColor: '#10b981' }} />
                <span>Green</span>
              </div>
              {themeColor === 'green' && <CheckOutlined className="text-xs" />}
            </div>
          ),
          onClick: () => setThemeColor('green'),
        },
        {
          type: 'divider',
        },
        {
          key: 'orange',
          label: (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 rounded" style={{ backgroundColor: '#f59e0b' }} />
                <span>Orange</span>
              </div>
              {themeColor === 'orange' && <CheckOutlined className="text-xs" />}
            </div>
          ),
          onClick: () => setThemeColor('orange'),
        },
      ],
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      label: 'Sign out',
      icon: <LogoutOutlined />,
      onClick: onSignOut,
    },
  ];

  return (
    <Layout className="min-h-screen">
      <Layout.Sider
        breakpoint="lg"
        collapsedWidth="0"
        theme="dark"
        style={{ background: currentTokens.colorPrimaryDeep }}
      >
        <div className="p-4">
          <BrandMark />
        </div>
        <Menu
          theme="dark"
          mode="inline"
          style={{ background: 'transparent' }}
          selectedKeys={selectedKeys}
          defaultOpenKeys={openGroups}
          items={items.map(toMenuItem)}
        />
      </Layout.Sider>
      <Layout>
        {/* A brand-coloured bar (a deep shade in dark mode): company name, employee search, bell and me. */}
        <Layout.Header
          className="app-header flex items-center justify-between gap-4 px-4 md:px-6"
          style={{
            background: isDarkMode ? currentTokens.colorPrimaryDeep : currentTokens.colorPrimary,
            borderBottom: isDarkMode ? `1px solid ${currentTokens.colorBorder}` : 'none',
            boxShadow: '0 1px 6px rgba(0, 0, 0, 0.12)',
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-6">
            {user?.organizationName ? (
              <span
                className="hidden max-w-[260px] shrink-0 truncate text-[15px] font-semibold uppercase tracking-wider text-white md:block"
                title={user.organizationName}
                data-testid="org-name"
              >
                {user.organizationName}
              </span>
            ) : null}
            {/* Employees only; a SUPER_ADMIN has no organization to search. */}
            {isOrgMember ? (
              <div className="w-full max-w-lg">
                <PeopleSearch />
              </div>
            ) : null}
          </div>
          <Space size="middle" align="center">
            {isOrgMember ? <NotificationBell /> : null}
            <Dropdown menu={{ items: userDropdown }}>
              <Space className="cursor-pointer select-none text-white">
                <Avatar
                  src={user?.avatar?.url}
                  style={{
                    // The same colours as every other avatar (PersonAvatar); the ring sets it off from the header bar.
                    ...avatarColors(currentTokens, isDarkMode),
                    border: '2px solid rgba(255, 255, 255, 0.7)',
                  }}
                >
                  {!user?.avatar?.url && initial}
                </Avatar>
                <span className="hidden font-medium sm:inline">{user?.name}</span>
                <DownOutlined className="text-xs" />
              </Space>
            </Dropdown>
          </Space>
        </Layout.Header>
        <Layout.Content className="p-4" style={{ background: currentTokens.colorBgLayout }}>
          <PlanExpiryBanner />
          <Outlet />
        </Layout.Content>
        <AiAssistant />
      </Layout>
    </Layout>
  );
}

