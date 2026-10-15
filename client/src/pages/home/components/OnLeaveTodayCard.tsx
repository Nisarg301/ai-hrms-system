import { CoffeeOutlined } from '@ant-design/icons';
import { Tag, theme } from 'antd';
import { PersonAvatar } from '../../../components/PersonAvatar/PersonAvatar';
import type { OnLeaveToday } from '../../../types/home';
import type { HalfDay } from '../../../types/leave';
import { EmptyNote, HomeCard } from './HomeCard';

export function halfDayLabel(halfDay: HalfDay | null): string | null {
  if (halfDay === 'first') return 'First half';
  if (halfDay === 'second') return 'Second half';
  return null;
}

export function OnLeaveTodayCard({ people }: { people: OnLeaveToday[] }) {
  const { token } = theme.useToken();
  return (
    <HomeCard title="On leave today" icon={<CoffeeOutlined />} extra={people.length ? <Tag>{people.length}</Tag> : null}>
      {people.length === 0 ? (
        <EmptyNote>No one's on leave today 🎉</EmptyNote>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {people.map((p) => (
            <li key={p.employeeId} className="flex items-center gap-3">
              <PersonAvatar name={p.name} avatarUrl={p.avatarUrl} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.name}</div>
                <div className="truncate text-xs" style={{ color: token.colorTextSecondary }}>
                  {p.leaveTypeName}
                </div>
              </div>
              {halfDayLabel(p.halfDay) ? <Tag color="gold">{halfDayLabel(p.halfDay)}</Tag> : null}
            </li>
          ))}
        </ul>
      )}
    </HomeCard>
  );
}
