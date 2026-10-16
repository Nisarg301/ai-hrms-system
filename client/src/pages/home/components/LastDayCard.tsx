import { FlagOutlined } from '@ant-design/icons';
import { Progress, theme } from 'antd';
import { TaskChecklist } from '../../../components/Lifecycle/TaskChecklist';
import type { LifecycleTask, MyLifecycle } from '../../../types/lifecycle';
import { percentFinished, shortDate } from '../../../utils/lifecycleFormat';
import { EmptyNote, HomeCard } from './HomeCard';

/** A leaver's Home: their last day and what's left for them to do. Deliberately quiet. */
export function LastDayCard({ process, today, onOpenTask }: { process: MyLifecycle; today: string; onOpenTask: (task: LifecycleTask) => void }) {
  const { token } = theme.useToken();
  return (
    <HomeCard title={`Your last day: ${shortDate(process.anchorDate)}`} icon={<FlagOutlined />}>
      <div className="mb-2 text-sm" style={{ color: token.colorTextSecondary }}>
        Thank you for everything. Here’s what’s left before you go.
      </div>
      <Progress percent={percentFinished(process.progress)} size="small" showInfo={false} strokeColor={token.colorPrimary} />
      {process.tasks.length ? <TaskChecklist tasks={process.tasks} today={today} onOpen={onOpenTask} /> : <EmptyNote>Nothing left for you to do.</EmptyNote>}
    </HomeCard>
  );
}
