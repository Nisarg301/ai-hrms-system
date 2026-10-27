import { Form, Input, Select } from 'antd';
import type { AiDepartmentFormValues } from '../../types/ai';
import { departmentSchema } from '../../validation/department.schema';

/** The same rules as the Departments page form; returns the first error per field. */
export function validateDepartmentValues(values: AiDepartmentFormValues): Record<string, string> {
  const parsed = departmentSchema.safeParse(values);
  if (parsed.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0]);
    errors[key] ??= issue.message;
  }
  return errors;
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

interface AiDepartmentFormProps {
  values: AiDepartmentFormValues;
  errors: Record<string, string>;
  onChange: (values: AiDepartmentFormValues) => void;
}

/** The confirm card's editable department fields, labelled as on the page's form. */
export function AiDepartmentForm({ values, errors, onChange }: AiDepartmentFormProps) {
  const set = <K extends keyof AiDepartmentFormValues>(key: K, value: AiDepartmentFormValues[K]) => onChange({ ...values, [key]: value });
  const item = (key: keyof AiDepartmentFormValues, label: string) => ({
    label,
    htmlFor: `ai-department-${key}`,
    validateStatus: errors[key] ? ('error' as const) : undefined,
    help: errors[key],
    className: '!mb-2',
  });

  return (
    <Form layout="vertical" size="small" component="div">
      <Form.Item {...item('title', 'Title')}>
        <Input id="ai-department-title" value={values.title} onChange={(e) => set('title', e.target.value)} />
      </Form.Item>
      <Form.Item {...item('description', 'Description')}>
        <Input.TextArea id="ai-department-description" autoSize={{ minRows: 2, maxRows: 4 }} value={values.description} onChange={(e) => set('description', e.target.value)} />
      </Form.Item>
      <Form.Item {...item('status', 'Status')}>
        <Select id="ai-department-status" value={values.status} onChange={(v) => set('status', v)} options={STATUS_OPTIONS} />
      </Form.Item>
    </Form>
  );
}
