import { Button, Card, Empty, Skeleton, Tag, theme } from 'antd';
import dayjs from 'dayjs';
import { PersonAvatar } from '../../../components/PersonAvatar/PersonAvatar';
import { useAppSelector } from '../../../hooks/store';
import { selectPerformance } from '../../../store/performance/performanceSelectors';
import { isOpenCycle, PART_STATUS_META, RATING_LABELS, reviewAction } from '../../../utils/performanceFormat';

function DueText({ date, done, today }: { date: string; done: boolean; today: string }) {
  const { token } = theme.useToken();
  const late = !done && date < today;
  return <span style={{ color: late ? token.colorError : token.colorTextSecondary }}>{`${late ? 'Overdue · was due' : 'Due'} ${dayjs(date).format('D MMM YYYY')}`}</span>;
}

/** My own review in each cycle: where my self review stands, and the manager's rating once released. */
export function MyReviews({ onOpen, today }: { onOpen: (id: string) => void; today: string }) {
  const { token } = theme.useToken();
  const { myReviews, myReviewsStatus } = useAppSelector(selectPerformance);
  if (myReviewsStatus !== 'succeeded' && !myReviews.length) return <Skeleton active />;
  if (!myReviews.length) return <Empty description="No reviews yet. They appear here when your admin starts a review cycle." />;
  return (
    <div className="flex flex-col gap-3">
      {myReviews.map((r) => {
        const action = reviewAction(r.selfStatus, isOpenCycle(r.cycle.status));
        return (
          <Card key={r.id} size="small" data-testid="my-review">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{r.cycle.name}</div>
                <div className="text-xs" style={{ color: token.colorTextSecondary }}>
                  {dayjs(r.cycle.periodFrom).format('D MMM YYYY')} – {dayjs(r.cycle.periodTo).format('D MMM YYYY')} ·{' '}
                  <DueText date={r.cycle.selfDueDate} done={r.selfStatus === 'submitted' || !isOpenCycle(r.cycle.status)} today={today} />
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Tag color={PART_STATUS_META[r.selfStatus].color}>Self review: {PART_STATUS_META[r.selfStatus].label}</Tag>
                  {r.released ? (
                    <Tag color="green">Manager’s rating: {r.managerRating ? `${r.managerRating} · ${RATING_LABELS[r.managerRating]}` : '—'}</Tag>
                  ) : (
                    <Tag>Manager’s review not released yet</Tag>
                  )}
                </div>
              </div>
              <Button type={action === 'View' ? 'default' : 'primary'} onClick={() => onOpen(r.id)} aria-label={`${action === 'Write' ? 'Write self review' : action}: ${r.cycle.name}`}>
                {action === 'Write' ? 'Write self review' : action}
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/** Manager reviews I'm to write (as the reviewer; admins also for people without one). */
export function ReviewsToWrite({ onOpen, today }: { onOpen: (id: string) => void; today: string }) {
  const { token } = theme.useToken();
  const { toWrite } = useAppSelector(selectPerformance);
  return (
    <div className="flex flex-col gap-3">
      {toWrite.map((r) => {
        const action = reviewAction(r.managerStatus, isOpenCycle(r.cycle.status));
        return (
          <Card key={r.id} size="small" data-testid="review-to-write">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <PersonAvatar name={r.employee?.name ?? '?'} avatarUrl={r.employee?.avatarUrl} />
                <div className="min-w-0">
                  <div className="font-medium">{r.employee?.name ?? 'Former member'}</div>
                  <div className="text-xs" style={{ color: token.colorTextSecondary }}>
                    {r.cycle.name} · <DueText date={r.cycle.managerDueDate} done={r.managerStatus === 'submitted'} today={today} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Tag color={PART_STATUS_META[r.selfStatus].color}>Their self review: {PART_STATUS_META[r.selfStatus].label}</Tag>
                    <Tag color={PART_STATUS_META[r.managerStatus].color}>Your review: {PART_STATUS_META[r.managerStatus].label}</Tag>
                  </div>
                </div>
              </div>
              <Button
                type={action === 'View' ? 'default' : 'primary'}
                onClick={() => onOpen(r.id)}
                aria-label={`${action === 'Write' ? 'Write review' : action}: ${r.employee?.name ?? 'Former member'}`}
              >
                {action === 'Write' ? 'Write review' : action}
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
