import { GiftOutlined } from '@ant-design/icons';
import { theme } from 'antd';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
import { ROUTES } from '../../../constants/routes';
import type { Holiday } from '../../../types/holiday';
import { daysBetween } from '../../../utils/dates';
import { EmptyNote, HomeCard } from './HomeCard';

function when(today: string, date: string): string {
  const days = daysBetween(today, date);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

export function UpcomingHolidaysCard({ holidays, today }: { holidays: Holiday[]; today: string }) {
  const { token } = theme.useToken();
  return (
    <HomeCard title="Upcoming holidays" icon={<GiftOutlined />} extra={<Link to={ROUTES.meHolidays}>View all</Link>}>
      {holidays.length === 0 ? (
        <EmptyNote>No upcoming holidays</EmptyNote>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {holidays.map((h) => {
            const d = dayjs(h.date);
            return (
              <li key={h.id} className="flex items-center gap-3">
                <div
                  className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg leading-none"
                  style={{ background: token.colorPrimaryBg, color: token.colorPrimary }}
                >
                  <span className="text-base font-semibold">{d.format('D')}</span>
                  <span className="text-[10px] uppercase">{d.format('MMM')}</span>
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium">{h.name}</div>
                  <div className="text-xs" style={{ color: token.colorTextSecondary }}>
                    {d.format('dddd')} · {when(today, h.date)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </HomeCard>
  );
}
