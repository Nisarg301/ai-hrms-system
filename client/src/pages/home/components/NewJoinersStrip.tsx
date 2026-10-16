import { RocketOutlined } from '@ant-design/icons';
import { theme } from 'antd';
import { PersonAvatar } from '../../../components/PersonAvatar/PersonAvatar';
import type { IntroductionCard } from '../../../types/people';
import { daysBetween } from '../../../utils/dates';
import { HomeCard } from './HomeCard';

export function joinedLabel(joiningDate: string, today: string): string {
  const days = daysBetween(joiningDate, today);
  if (days <= 0) return 'Joined today';
  if (days === 1) return 'Joined yesterday';
  return `Joined ${days} days ago`;
}

export function NewJoinersStrip({ people, today }: { people: IntroductionCard[]; today: string }) {
  const { token } = theme.useToken();
  if (people.length === 0) return null;
  return (
    <HomeCard title="New joiners" icon={<RocketOutlined />}>
      <div className="flex gap-4 overflow-x-auto pb-1" aria-label="New joiners">
        {people.map((p) => (
          <div key={p.id} className="flex w-32 shrink-0 flex-col items-center gap-1 rounded-xl p-3 text-center" style={{ background: token.colorPrimaryBg }}>
            <PersonAvatar name={p.name} avatarUrl={p.avatarUrl} size={56} />
            <div className="w-full truncate font-medium">{p.name}</div>
            <div className="w-full truncate text-xs" style={{ color: token.colorTextSecondary }}>
              {p.jobTitle ?? p.departmentName ?? ''}
            </div>
            <div className="text-xs" style={{ color: token.colorPrimary }}>
              {joinedLabel(p.joiningDate, today)}
            </div>
          </div>
        ))}
      </div>
    </HomeCard>
  );
}
