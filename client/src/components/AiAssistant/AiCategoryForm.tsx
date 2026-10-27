import { Form, Input, InputNumber, Switch } from 'antd';
import type { AiCategoryFormValues } from '../../types/ai';
import { expenseCategorySchema } from '../../validation/expenseCategory.schema';

/** The same rules as the Categories tab's form; returns the first error per field. */
export function validateCategoryValues(values: AiCategoryFormValues): Record<string, string> {
  const parsed = expenseCategorySchema.safeParse(values);
  if (parsed.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0]);
    errors[key] ??= issue.message;
  }
  return errors;
}

interface AiCategoryFormProps {
  values: AiCategoryFormValues;
  errors: Record<string, string>;
  onChange: (values: AiCategoryFormValues) => void;
}

/** The confirm card's editable category fields, labelled as on the page's form. Amounts in rupees. */
export function AiCategoryForm({ values, errors, onChange }: AiCategoryFormProps) {
  const set = <K extends keyof AiCategoryFormValues>(key: K, value: AiCategoryFormValues[K]) => onChange({ ...values, [key]: value });
  const item = (key: keyof AiCategoryFormValues, label: string, help?: string) => ({
    label,
    htmlFor: `ai-category-${key}`,
    validateStatus: errors[key] ? ('error' as const) : undefined,
    help: errors[key] ?? help,
    className: '!mb-2',
  });

  return (
    <Form layout="vertical" size="small" component="div">
      <Form.Item {...item('name', 'Name')}>
        <Input id="ai-category-name" maxLength={60} value={values.name} onChange={(e) => set('name', e.target.value)} />
      </Form.Item>
      <Form.Item {...item('limitRupees', 'Limit per expense', 'Empty for no limit.')}>
        <InputNumber id="ai-category-limitRupees" className="w-full" prefix="₹" min={0} precision={2} placeholder="No limit" value={values.limitRupees} onChange={(v) => set('limitRupees', v ?? null)} />
      </Form.Item>
      <Form.Item {...item('receiptAboveRupees', 'Receipt needed above', '0 means a receipt is always needed.')}>
        <InputNumber
          id="ai-category-receiptAboveRupees"
          className="w-full"
          prefix="₹"
          min={0}
          precision={2}
          value={values.receiptAboveRupees}
          // Cleared: the schema says what's wrong.
          onChange={(v) => set('receiptAboveRupees', v ?? (undefined as unknown as number))}
        />
      </Form.Item>
      <Form.Item {...item('isActive', 'Active')}>
        <Switch id="ai-category-isActive" size="small" checked={values.isActive} onChange={(v) => set('isActive', v)} />
      </Form.Item>
    </Form>
  );
}
