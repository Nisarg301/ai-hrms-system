import { DatePicker, Form, Input, Select } from 'antd';
import dayjs from 'dayjs';
import type { AiProjectFormValues } from '../../types/ai';
import { projectSchema } from '../../validation/project.schemas';

/** The same rules as the Projects page form; returns the first error per field. */
export function validateProjectValues(values: AiProjectFormValues): Record<string, string> {
  const parsed = projectSchema.safeParse(values);
  if (parsed.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0]);
    errors[key] ??= issue.message;
  }
  return errors;
}

const STATUS_OPTIONS = [
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'on-hold', label: 'On hold' },
];

interface AiProjectFormProps {
  values: AiProjectFormValues;
  errors: Record<string, string>;
  onChange: (values: AiProjectFormValues) => void;
}

/** The confirm card's editable project fields. The deadline is a calendar day (YYYY-MM-DD). */
export function AiProjectForm({ values, errors, onChange }: AiProjectFormProps) {
  const set = <K extends keyof AiProjectFormValues>(key: K, value: AiProjectFormValues[K]) => onChange({ ...values, [key]: value });
  const item = (key: keyof AiProjectFormValues, label: string) => ({
    label,
    htmlFor: `ai-project-${key}`,
    validateStatus: errors[key] ? ('error' as const) : undefined,
    help: errors[key],
    className: '!mb-2',
  });

  return (
    <Form layout="vertical" size="small" component="div">
      <Form.Item {...item('name', 'Name')}>
        <Input id="ai-project-name" value={values.name} onChange={(e) => set('name', e.target.value)} />
      </Form.Item>
      <Form.Item {...item('description', 'Description')}>
        <Input.TextArea id="ai-project-description" autoSize={{ minRows: 2, maxRows: 4 }} value={values.description} onChange={(e) => set('description', e.target.value)} />
      </Form.Item>
      <Form.Item {...item('deadline', 'Deadline')}>
        <DatePicker
          id="ai-project-deadline"
          className="w-full"
          format={['DD MMM YYYY', 'YYYY-MM-DD']}
          value={values.deadline ? dayjs(values.deadline) : null}
          onChange={(d) => set('deadline', d ? d.format('YYYY-MM-DD') : '')}
        />
      </Form.Item>
      <Form.Item {...item('status', 'Status')}>
        <Select id="ai-project-status" value={values.status} onChange={(v) => set('status', v)} options={STATUS_OPTIONS} />
      </Form.Item>
    </Form>
  );
}
