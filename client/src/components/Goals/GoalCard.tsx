import { Card, Progress, Tag, theme } from 'antd';
import dayjs from 'dayjs';
import type { Goal } from '../../types/performance';
import { GOAL_STATUS_META } from '../../utils/performanceFormat';

/** A goal at a glance: status, progress, due date and weight. Opens the goal. */
export function GoalCard({ goal, onOpen }: { goal: Goal; onOpen: () => void }) {
  const { token } = theme.useToken();
  const meta = GOAL_STATUS_META[goal.status];
  const finished = goal.status === 'completed' || goal.status === 'cancelled';
  return (
    <Card hoverable size="small" className="h-full" data-testid="goal-card">
      <button type="button" className="w-full cursor-pointer border-0 bg-transparent p-0 text-left" aria-label={`Open ${goal.title}`} onClick={onOpen}>
        <div className="mb-1 flex items-start justify-between gap-2">
          <span className="font-medium" style={{ color: finished ? token.colorTextTertiary : undefined }}>
            {goal.title}
          </span>
          <Tag color={meta.color} className="!mr-0 shrink-0">
            {meta.label}
          </Tag>
        </div>
        <Progress percent={goal.progress} size="small" status={goal.status === 'behind' ? 'exception' : undefined} />
        <div className="flex flex-wrap justify-between gap-2 text-xs" style={{ color: goal.overdue ? token.colorError : token.colorTextSecondary }}>
          <span>{goal.overdue ? `Overdue · was due ${dayjs(goal.dueDate).format('D MMM')}` : `Due ${dayjs(goal.dueDate).format('D MMM YYYY')}`}</span>
          {goal.weight !== null ? <span style={{ color: token.colorTextSecondary }}>Weight {goal.weight}%</span> : null}
        </div>
      </button>
    </Card>
  );
}
