import { SmileOutlined } from '@ant-design/icons';
import { Button, Tag, theme } from 'antd';
import dayjs from 'dayjs';
import { PersonAvatar } from '../../../components/PersonAvatar/PersonAvatar';
import type { Celebration } from '../../../types/home';
import { EmptyNote, HomeCard } from './HomeCard';

interface CelebrationsCardProps {
  today: Celebration[];
  upcoming: Celebration[];
  myId: string;
  /** Fills the post box with a greeting. */
  onWish: (text: string) => void;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** "Happy birthday, Ivy! 🎂🎉" / "Happy 3-year work anniversary, Ivy! 🎉" */
export function wishText(c: Celebration): string {
  const name = firstName(c.person.name);
  return c.kind === 'birthday' ? `Happy birthday, ${name}! 🎂🎉 ` : `Happy ${c.years}-year work anniversary, ${name}! 🎉 `;
}

function what(c: Celebration, when: 'today' | 'soon'): string {
  if (c.kind === 'birthday') return when === 'today' ? '🎂 Birthday today' : '🎂 Birthday';
  const years = `${c.years} year${c.years === 1 ? '' : 's'}`;
  return when === 'today' ? `🎉 ${years} with us today` : `🎉 ${years} with us`;
}

export function CelebrationsCard({ today, upcoming, myId, onWish }: CelebrationsCardProps) {
  const { token } = theme.useToken();
  return (
    <HomeCard title="Celebrations" icon={<SmileOutlined />}>
      {today.length === 0 && upcoming.length === 0 ? (
        <EmptyNote>No birthdays or work anniversaries this week</EmptyNote>
      ) : (
        <>
          {today.length ? (
            <ul className="m-0 mb-3 flex list-none flex-col gap-3 p-0" aria-label="Today">
              {today.map((c) => {
                const mine = c.person.id === myId;
                return (
                  <li
                    key={`${c.person.id}-${c.kind}`}
                    data-testid="celebration-today"
                    className="flex items-center gap-3 rounded-xl p-3"
                    style={{ background: token.colorPrimaryBg }}
                  >
                    <PersonAvatar name={c.person.name} avatarUrl={c.person.avatarUrl} size="large" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{mine ? 'You' : c.person.name}</div>
                      <div className="text-xs" style={{ color: token.colorTextSecondary }}>
                        {what(c, 'today')}
                      </div>
                    </div>
                    {mine ? (
                      <Tag color="magenta" className="!mr-0">
                        {c.kind === 'birthday' ? 'Happy birthday!' : 'Congratulations!'}
                      </Tag>
                    ) : (
                      <Button size="small" type="primary" ghost onClick={() => onWish(wishText(c))} aria-label={`Wish ${c.person.name}`}>
                        Wish
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {upcoming.length ? (
            <>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: token.colorTextSecondary }}>
                Coming up
              </div>
              <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Coming up">
                {upcoming.map((c) => (
                  <li key={`${c.person.id}-${c.kind}-${c.date}`} data-testid="celebration-upcoming" className="flex items-center gap-2">
                    <PersonAvatar name={c.person.name} avatarUrl={c.person.avatarUrl} size="small" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {c.person.name} <span style={{ color: token.colorTextSecondary }}>· {what(c, 'soon')}</span>
                    </span>
                    <span className="shrink-0 text-xs" style={{ color: token.colorTextSecondary }}>
                      {dayjs(c.date).format('ddd, D MMM')}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </HomeCard>
  );
}
