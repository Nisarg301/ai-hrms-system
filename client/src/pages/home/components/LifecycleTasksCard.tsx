import { SolutionOutlined } from '@ant-design/icons';
import { Tag, theme } from 'antd';
import { PersonAvatar } from '../../../components/PersonAvatar/PersonAvatar';
import { TaskChecklist } from '../../../components/Lifecycle/TaskChecklist';
import type { AssignedGroup, LifecycleTask } from '../../../types/lifecycle';
import { shortDate } from '../../../utils/lifecycleFormat';
import { HomeCard } from './HomeCard';

/** "Joins Mon, 12 Oct", "Joined …", "Leaves …", "Left …". */
function anchorText(g: AssignedGroup, today: string): string {
  const past = g.anchorDate < today;
  const verb = g.kind === 'onboarding' ? (past ? 'Joined' : 'Joins') : past ? 'Left' : 'Leaves';
  return `${verb} ${shortDate(g.anchorDate)}`;
}

/** Tasks I do for people joining or leaving (as their manager, buddy, an admin, or named), by person. */
export function LifecycleTasksCard({
  groups,
  today,
  onOpenTask,
}: {
  groups: AssignedGroup[];
  today: string;
  onOpenTask: (task: LifecycleTask, group: AssignedGroup) => void;
}) {
  const { token } = theme.useToken();
  const count = groups.reduce((n, g) => n + g.tasks.length, 0);
  const overdue = groups.reduce((n, g) => n + g.tasks.filter((t) => t.overdue).length, 0);
  return (
    <HomeCard
      title="Your onboarding & offboarding tasks"
      icon={<SolutionOutlined />}
      extra={<Tag color={overdue ? 'red' : undefined}>{overdue ? `${overdue} overdue` : count}</Tag>}
    >
      <div className="flex flex-col gap-4" data-testid="lifecycle-tasks">
        {groups.map((g) => (
          <section key={g.processId} aria-label={`${g.employee?.name ?? 'Someone'}'s ${g.kind}`}>
            <div className="mb-1 flex items-center gap-2">
              <PersonAvatar name={g.employee?.name ?? '?'} avatarUrl={g.employee?.avatarUrl} size="small" />
              <span className="min-w-0 flex-1 truncate font-medium">{g.employee?.name ?? 'Former member'}</span>
              <span className="text-xs" style={{ color: token.colorTextSecondary }}>
                {anchorText(g, today)}
              </span>
            </div>
            <TaskChecklist tasks={g.tasks} today={today} onOpen={(t) => onOpenTask(t, g)} />
          </section>
        ))}
      </div>
    </HomeCard>
  );
}
