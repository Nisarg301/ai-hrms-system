import { Card, Progress, theme, Typography } from 'antd';
import { PersonAvatar } from '../../../components/PersonAvatar/PersonAvatar';
import { TaskChecklist } from '../../../components/Lifecycle/TaskChecklist';
import type { LifecycleTask, MyLifecycle } from '../../../types/lifecycle';
import type { Person } from '../../../types/people';
import { daysFrom, percentFinished, shortDate } from '../../../utils/lifecycleFormat';

interface WelcomeAboardCardProps {
  process: MyLifecycle;
  firstName: string;
  today: string;
  onOpenTask: (task: LifecycleTask) => void;
  onOpenPerson: (id: string) => void;
}

/** "Starts in 7 days", "Today's your first day!", "Day 3". */
function startLine(anchorDate: string, today: string): string {
  const days = daysFrom(today, anchorDate);
  if (days > 1) return `You join on ${shortDate(anchorDate)}, in ${days} days.`;
  if (days === 1) return `You join tomorrow, ${shortDate(anchorDate)}.`;
  if (days === 0) return 'Today’s your first day!';
  return `Day ${-days + 1}. You joined on ${shortDate(anchorDate)}.`;
}

function PersonChip({ label, person, onOpen }: { label: string; person: Person; onOpen: (id: string) => void }) {
  const { token } = theme.useToken();
  return (
    <button
      type="button"
      onClick={() => onOpen(person.id)}
      aria-label={`${label}: ${person.name}`}
      className="flex cursor-pointer items-center gap-2 rounded-full border-0 py-1 pl-1 pr-3 text-left"
      style={{ background: token.colorBgContainer }}
    >
      <PersonAvatar name={person.name} avatarUrl={person.avatarUrl} size="small" />
      <span>
        <span className="block text-xs" style={{ color: token.colorTextSecondary }}>
          {label}
        </span>
        <span className="block font-medium">{person.name}</span>
      </span>
    </button>
  );
}

/** A new joiner's Home: when they start, who to turn to, how far along they are, and their checklist. */
export function WelcomeAboardCard({ process, firstName, today, onOpenTask, onOpenPerson }: WelcomeAboardCardProps) {
  const { token } = theme.useToken();
  const percent = percentFinished(process.progress);
  return (
    <Card className="mb-4" styles={{ body: { padding: 0 } }} data-testid="welcome-aboard">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-t-lg p-5" style={{ background: token.colorSuccessBg }}>
        <div className="min-w-0">
          <Typography.Title level={4} className="!mb-1">
            Welcome aboard, {firstName}! 🎉
          </Typography.Title>
          <div style={{ color: token.colorTextSecondary }}>{startLine(process.anchorDate, today)}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {process.manager ? <PersonChip label="Your manager" person={process.manager} onOpen={onOpenPerson} /> : null}
            {process.buddy ? <PersonChip label="Your buddy" person={process.buddy} onOpen={onOpenPerson} /> : null}
          </div>
        </div>
        <Progress
          type="circle"
          size={84}
          percent={percent}
          strokeColor={token.colorSuccess}
          format={() => (
            <span className="text-sm" aria-label={`${percent}% of onboarding finished`}>
              {percent}%
            </span>
          )}
        />
      </div>
      <div className="p-4">
        <div className="mb-1 font-medium">Your checklist</div>
        {process.tasks.length ? (
          <TaskChecklist tasks={process.tasks} today={today} onOpen={onOpenTask} />
        ) : (
          <div style={{ color: token.colorTextSecondary }}>Nothing for you to do yet. Your team is getting things ready.</div>
        )}
      </div>
    </Card>
  );
}
