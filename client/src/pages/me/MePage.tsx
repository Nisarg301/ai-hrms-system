import { AimOutlined, CalendarOutlined, ClockCircleOutlined, GiftOutlined, TeamOutlined, UserOutlined, WalletOutlined } from '@ant-design/icons';
import { Tabs } from 'antd';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ROUTES } from '../../constants/routes';
import { useHasFeature } from '../../hooks/useHasFeature';
import { AttendanceTab } from './components/AttendanceTab';
import { ExpensesTab } from './components/ExpensesTab';
import { HolidaysTab } from './components/HolidaysTab';
import { LeaveTab } from './components/LeaveTab';
import { PerformanceTab } from './components/PerformanceTab';
import { ProfileTab } from './components/ProfileTab';
import { TeamTab } from './components/TeamTab';

const TABS = ['leave', 'attendance', 'expenses', 'performance', 'profile', 'team', 'holidays'] as const;
type MeTab = (typeof TABS)[number];

/** My leave, attendance, expenses, performance, profile, team and holidays (expenses and performance as the plan allows); the tab is the last part of the URL (/me/team). */
export default function MePage() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const hasFeature = useHasFeature();
  const available = TABS.filter((t) => (t === 'expenses' ? hasFeature('expenses') : t === 'performance' ? hasFeature('performance') : true));
  if (!available.includes(tab as MeTab)) {
    return <Navigate to={`${ROUTES.me}/leave`} replace />;
  }
  return (
    <Tabs
      activeKey={tab}
      onChange={(key) => navigate(`${ROUTES.me}/${key}`)}
      destroyOnHidden
      items={[
        { key: 'leave', label: 'Leave', icon: <CalendarOutlined />, children: <LeaveTab /> },
        { key: 'attendance', label: 'Attendance', icon: <ClockCircleOutlined />, children: <AttendanceTab /> },
        { key: 'expenses', label: 'Expenses', icon: <WalletOutlined />, children: <ExpensesTab /> },
        { key: 'performance', label: 'Performance', icon: <AimOutlined />, children: <PerformanceTab /> },
        { key: 'profile', label: 'Profile', icon: <UserOutlined />, children: <ProfileTab /> },
        { key: 'team', label: 'Team', icon: <TeamOutlined />, children: <TeamTab /> },
        { key: 'holidays', label: 'Holidays', icon: <GiftOutlined />, children: <HolidaysTab /> },
      ].filter((item) => available.includes(item.key as MeTab))}
    />
  );
}
