import { AimOutlined } from '@ant-design/icons';
import { Button, theme } from 'antd';
import dayjs from 'dayjs';
import type { Goal, MyReviewRow, ReviewToWriteRow } from '../../../types/performance';
import { isOpenCycle, needsCheckIn } from '../../../utils/performanceFormat';
import { HomeCard } from './HomeCard';

interface PerformanceCardProps {
  myReviews: MyReviewRow[];
  toWrite: ReviewToWriteRow[];
  goals: Goal[];
  today: string;
  onOpenReview: (id: string) => void;
  onOpenGoals: () => void;
}

/** Reviews I still have to write (mine, and as a reviewer), and goals gone a month without a check-in. Hidden when there's nothing. */
export function PerformanceCard({ myReviews, toWrite, goals, today, onOpenReview, onOpenGoals }: PerformanceCardProps) {
  const { token } = theme.useToken();
  const due = [
    ...myReviews
      .filter((r) => isOpenCycle(r.cycle.status) && r.selfStatus !== 'submitted')
      .map((r) => ({ id: r.id, label: `Your ${r.cycle.name} self review`, date: r.cycle.selfDueDate })),
    ...toWrite
      .filter((r) => isOpenCycle(r.cycle.status) && r.managerStatus !== 'submitted')
      .map((r) => ({ id: r.id, label: `Review of ${r.employee?.name ?? 'a former member'} (${r.cycle.name})`, date: r.cycle.managerDueDate })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const stale = goals.filter((g) => needsCheckIn(g, today)).length;
  if (!due.length && !stale) return null;

  return (
    <HomeCard title={due.length ? 'Reviews due' : 'Your goals'} icon={<AimOutlined />}>
      <div className="flex flex-col gap-2" data-testid="performance-card">
        {due.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpenReview(item.id)}
            className="flex w-full cursor-pointer items-baseline justify-between gap-2 rounded border-0 bg-transparent p-1 text-left hover:bg-black/5"
          >
            <span className="min-w-0 truncate">{item.label}</span>
            <span className="shrink-0 text-xs" style={{ color: item.date < today ? token.colorError : token.colorTextSecondary }}>
              {item.date < today ? 'Overdue' : item.date === today ? 'Due today' : `Due ${dayjs(item.date).format('D MMM')}`}
            </span>
          </button>
        ))}
        {stale ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span style={{ color: token.colorTextSecondary }}>
              {stale === 1 ? '1 goal hasn’t' : `${stale} goals haven’t`} had a check-in for a month.
            </span>
            <Button size="small" type="link" onClick={onOpenGoals}>
              Check in
            </Button>
          </div>
        ) : null}
      </div>
    </HomeCard>
  );
}
