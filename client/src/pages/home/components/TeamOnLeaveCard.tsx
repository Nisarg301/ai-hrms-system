import { TeamOutlined } from '@ant-design/icons';
import { Avatar, Tag, theme, Tooltip } from 'antd';
import { PersonAvatar } from '../../../components/PersonAvatar/PersonAvatar';
import type { HomeSummary } from '../../../types/home';
import { shortDate } from '../../../utils/dates';
import { EmptyNote, HomeCard } from './HomeCard';
import { halfDayLabel } from './OnLeaveTodayCard';

export function TeamOnLeaveCard({ team }: { team: HomeSummary['teamOnLeave'] }) {
  const { token } = theme.useToken();
  let content;
  if (team.size === 0) {
    content = <EmptyNote>You're not in a team yet. Ask your admin to set your manager.</EmptyNote>;
  } else if (team.thisWeek.length === 0) {
    content = <EmptyNote>Your whole team is in this week 💪</EmptyNote>;
  } else {
    content = (
      <>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: token.colorTextSecondary }}>
          Today
        </div>
        {team.today.length === 0 ? (
          <div className="mb-3 text-sm">Everyone's in today.</div>
        ) : (
          <Avatar.Group className="mb-3">
            {team.today.map((p) => (
              <Tooltip key={p.id} title={[p.name, halfDayLabel(p.halfDay)].filter(Boolean).join(' · ')}>
                <span>
                  <PersonAvatar name={p.name} avatarUrl={p.avatarUrl} />
                </span>
              </Tooltip>
            ))}
          </Avatar.Group>
        )}
        <div className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: token.colorTextSecondary }}>
          This week
        </div>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {team.thisWeek.map(({ person, dates }) => (
            <li key={person.id} className="flex items-center gap-2">
              <PersonAvatar name={person.name} avatarUrl={person.avatarUrl} size="small" />
              <span className="min-w-0 flex-1 truncate text-sm">{person.name}</span>
              <span className="flex flex-wrap justify-end gap-1">
                {dates.map((d) => (
                  <Tag key={d} className="!mr-0">
                    {shortDate(d)}
                  </Tag>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </>
    );
  }
  return (
    <HomeCard title="My team on leave" icon={<TeamOutlined />}>
      {content}
    </HomeCard>
  );
}
