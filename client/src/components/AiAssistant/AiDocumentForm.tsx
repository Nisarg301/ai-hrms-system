import { AutoComplete, Form, Input, Select } from 'antd';
import type { AiDocumentFormValues } from '../../types/ai';
import { documentSchema } from '../../validation/document.schemas';

/** The same rules as the Documents page form; returns the first error per field. */
export function validateDocumentValues(values: AiDocumentFormValues): Record<string, string> {
  const parsed = documentSchema.safeParse(values);
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
  { value: 'archived', label: 'Archived' },
];

interface AiDocumentFormProps {
  values: AiDocumentFormValues;
  /** The categories in use, suggested as the user types. */
  categories: string[];
  errors: Record<string, string>;
  onChange: (values: AiDocumentFormValues) => void;
}

/** The confirm card's editable document fields, labelled as on the page's form. The file is chosen on the card. */
export function AiDocumentForm({ values, categories, errors, onChange }: AiDocumentFormProps) {
  const set = <K extends keyof AiDocumentFormValues>(key: K, value: AiDocumentFormValues[K]) => onChange({ ...values, [key]: value });
  const item = (key: keyof AiDocumentFormValues, label: string) => ({
    label,
    htmlFor: `ai-document-${key}`,
    validateStatus: errors[key] ? ('error' as const) : undefined,
    help: errors[key],
    className: '!mb-2',
  });
  const typed = values.category.trim().toLowerCase();

  return (
    <Form layout="vertical" size="small" component="div">
      <Form.Item {...item('title', 'Title')}>
        <Input id="ai-document-title" value={values.title} onChange={(e) => set('title', e.target.value)} />
      </Form.Item>
      <Form.Item {...item('description', 'Description')}>
        <Input.TextArea id="ai-document-description" autoSize={{ minRows: 2, maxRows: 4 }} value={values.description} onChange={(e) => set('description', e.target.value)} />
      </Form.Item>
      <Form.Item {...item('category', 'Category')}>
        <AutoComplete
          id="ai-document-category"
          value={values.category}
          onChange={(v) => set('category', v)}
          options={categories.filter((c) => !typed || c.toLowerCase().includes(typed)).map((c) => ({ value: c }))}
        />
      </Form.Item>
      <Form.Item {...item('status', 'Status')}>
        <Select id="ai-document-status" value={values.status} onChange={(v) => set('status', v)} options={STATUS_OPTIONS} />
      </Form.Item>
    </Form>
  );
}
