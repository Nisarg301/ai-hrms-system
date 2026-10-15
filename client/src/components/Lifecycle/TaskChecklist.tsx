import { CheckCircleFilled, MinusCircleOutlined } from '@ant-design/icons';
import { Tag, theme } from 'antd';
import type { LifecycleTask } from '../../types/lifecycle';
import { dueText, TASK_TYPE_LABEL } from '../../utils/lifecycleFormat';

interface TaskChecklistProps {
  tasks: LifecycleTask[];
  today: string;
  onOpen: (task: LifecycleTask) => void;
}

/** Tasks as a checklist; each row opens the task panel. */
export function TaskChecklist({ tasks, today, onOpen }: TaskChecklistProps) {
  const { token } = theme.useToken();
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="task-checklist">
      {tasks.map((task) => {
        const finished = task.status !== 'pending';
        const typeLabel = TASK_TYPE_LABEL[task.type];
        return (
          <li key={task.id}>
            <button
              type="button"
              onClick={() => onOpen(task)}
              aria-label={`${task.title}: ${dueText(task, today)}`}
              className="flex w-full cursor-pointer items-center gap-3 rounded-lg border-0 bg-transparent px-2 py-2 text-left hover:bg-black/5"
            >
              {task.status === 'done' ? (
                <CheckCircleFilled style={{ color: token.colorSuccess, fontSize: 18 }} aria-hidden />
              ) : task.status === 'skipped' ? (
                <MinusCircleOutlined style={{ color: token.colorTextQuaternary, fontSize: 18 }} aria-hidden />
              ) : (
                <span
                  aria-hidden
                  className="inline-block h-[18px] w-[18px] shrink-0 rounded-full border-2"
                  style={{ borderColor: task.overdue ? token.colorError : token.colorBorder }}
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate" style={{ color: finished ? token.colorTextTertiary : undefined, textDecoration: task.status === 'done' ? 'line-through' : undefined }}>
                  {task.title}
                </span>
                <span className="text-xs" style={{ color: task.overdue ? token.colorError : token.colorTextSecondary }}>
                  {dueText(task, today)}
                </span>
              </span>
              {typeLabel && !finished ? <Tag className="!mr-0">{typeLabel}</Tag> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
