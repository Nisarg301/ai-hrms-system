import { DatePicker, Form, Input, Select } from 'antd';
import dayjs from 'dayjs';
import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectAllProjects } from '../../store/projects/projectsSelectors';
import { fetchAllProjects } from '../../store/projects/projectsThunks';
import { selectPeople } from '../../store/team/teamSelectors';
import { fetchPeople } from '../../store/team/teamThunks';
import type { AiTaskFormValues } from '../../types/ai';
import { taskSchema } from '../../validation/task.schemas';

/** The same rules as the Tasks page form; returns the first error per field. */
export function validateTaskValues(values: AiTaskFormValues): Record<string, string> {
  const parsed = taskSchema.safeParse(values);
  if (parsed.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0]);
    errors[key] ??= issue.message;
  }
  return errors;
}

// The page's labels.
const STATUS_OPTIONS = [
  { value: 'todo', label: 'To Do' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'blocked', label: 'Blocked' },
];

type Option = { value: string; label: string };

/** The list's options, plus the card's own name for any chosen id the list lacks (a disabled employee, say). */
function withChosen(options: Option[], chosen: string[], labels: Record<string, string>): Option[] {
  const missing = chosen.filter((id) => id && !options.some((o) => o.value === id)).map((id) => ({ value: id, label: labels[id] ?? id }));
  return [...options, ...missing];
}

interface AiTaskFormProps {
  values: AiTaskFormValues;
  labels: Record<string, string>;
  errors: Record<string, string>;
  onChange: (values: AiTaskFormValues) => void;
}

/** The confirm card's editable task fields. Members are employees, as on the Tasks page. */
export function AiTaskForm({ values, labels, errors, onChange }: AiTaskFormProps) {
  const dispatch = useAppDispatch();
  const projects = useAppSelector(selectAllProjects);
  const people = useAppSelector(selectPeople);

  useEffect(() => {
    void dispatch(fetchAllProjects());
    void dispatch(fetchPeople());
  }, [dispatch]);

  const set = <K extends keyof AiTaskFormValues>(key: K, value: AiTaskFormValues[K]) => onChange({ ...values, [key]: value });
  const item = (key: keyof AiTaskFormValues, label: string) => ({
    label,
    htmlFor: `ai-task-${key}`,
    validateStatus: errors[key] ? ('error' as const) : undefined,
    help: errors[key],
    className: '!mb-2',
  });
  const projectOptions = withChosen(projects.map((p) => ({ value: p.id, label: p.name })), [values.projectId], labels);
  const memberOptions = withChosen(people.filter((p) => p.role === 'ORG_USER').map((p) => ({ value: p.id, label: p.name })), values.userId, labels);

  return (
    <Form layout="vertical" size="small" component="div">
      <Form.Item {...item('title', 'Title')}>
        <Input id="ai-task-title" value={values.title} onChange={(e) => set('title', e.target.value)} />
      </Form.Item>
      <Form.Item {...item('description', 'Description')}>
        <Input.TextArea id="ai-task-description" autoSize={{ minRows: 2, maxRows: 4 }} value={values.description} onChange={(e) => set('description', e.target.value)} />
      </Form.Item>
      <Form.Item {...item('dueDate', 'Due date')}>
        <DatePicker
          id="ai-task-dueDate"
          className="w-full"
          format={['DD MMM YYYY', 'YYYY-MM-DD']}
          value={values.dueDate ? dayjs(values.dueDate) : null}
          onChange={(d) => set('dueDate', d ? d.format('YYYY-MM-DD') : '')}
        />
      </Form.Item>
      <Form.Item {...item('status', 'Status')}>
        <Select id="ai-task-status" value={values.status} onChange={(v) => set('status', v)} options={STATUS_OPTIONS} />
      </Form.Item>
      <Form.Item {...item('projectId', 'Project')}>
        <Select
          id="ai-task-projectId"
          showSearch
          optionFilterProp="label"
          placeholder="Select a project"
          value={values.projectId || undefined}
          onChange={(v) => set('projectId', v ?? '')}
          options={projectOptions}
        />
      </Form.Item>
      <Form.Item {...item('userId', 'Members')}>
        <Select
          id="ai-task-userId"
          mode="multiple"
          showSearch
          optionFilterProp="label"
          placeholder="Select members"
          value={values.userId}
          onChange={(v) => set('userId', v)}
          options={memberOptions}
        />
      </Form.Item>
    </Form>
  );
}
