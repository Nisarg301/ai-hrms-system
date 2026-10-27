import { DatePicker, Form, Input, InputNumber, Select, Switch } from 'antd';
import dayjs from 'dayjs';
import type { AiClaimCategoryOption, AiClaimFormValues } from '../../types/ai';
import { MAX_EXPENSE_AGE_DAYS, toPaise } from '../../utils/expenseFormat';
import { formatInrExact } from '../../utils/formatInr';

const FORMATS = ['DD MMM YYYY', 'YYYY-MM-DD'];
const MAX_RUPEES = 1_000_000;

/** Whether this expense needs a receipt: above its category's receipt limit (0 = always), as on the page. */
export function claimNeedsReceipt(values: AiClaimFormValues, categories: AiClaimCategoryOption[]): boolean {
  const category = categories.find((c) => c.id === values.categoryId);
  return Boolean(category && values.amountRupees !== null && toPaise(values.amountRupees) > category.receiptRequiredAbovePaise);
}

/** The claim drawer's rules for an expense, and a title for a new claim. */
export function validateClaimValues(values: AiClaimFormValues, mode: 'create' | 'update'): Record<string, string> {
  const errors: Record<string, string> = {};
  if (mode === 'create' && !values.title.trim()) errors.title = 'Give the claim a title';
  else if (values.title.length > 120) errors.title = 'At most 120 characters';
  if (!values.date) errors.date = 'Choose the date';
  if (!values.categoryId) errors.categoryId = 'Choose a category';
  if (values.amountRupees === null || values.amountRupees <= 0) errors.amountRupees = 'Enter the amount';
  else if (values.amountRupees > MAX_RUPEES) errors.amountRupees = 'At most ₹10,00,000 per expense';
  if (!values.merchant.trim()) errors.merchant = 'Say where you spent it';
  else if (values.merchant.length > 120) errors.merchant = 'At most 120 characters';
  if (values.note.length > 500) errors.note = 'At most 500 characters';
  return errors;
}

interface AiClaimFormProps {
  mode: 'create' | 'update';
  values: AiClaimFormValues;
  categories: AiClaimCategoryOption[];
  errors: Record<string, string>;
  onChange: (values: AiClaimFormValues) => void;
}

/** The confirm card's claim: its title (a new claim), one expense, and Submit now. The receipt is chosen below the form. */
export function AiClaimForm({ mode, values, categories, errors, onChange }: AiClaimFormProps) {
  const set = <K extends keyof AiClaimFormValues>(key: K, value: AiClaimFormValues[K]) => onChange({ ...values, [key]: value });
  const category = categories.find((c) => c.id === values.categoryId);
  const earliest = dayjs().subtract(MAX_EXPENSE_AGE_DAYS, 'day');
  const rule = category ? (category.receiptRequiredAbovePaise === 0 ? `${category.name} always needs a receipt.` : `${category.name} needs a receipt above ${formatInrExact(category.receiptRequiredAbovePaise)}.`) : undefined;
  const item = (key: keyof AiClaimFormValues, label: string, help?: string) => ({
    label,
    htmlFor: `ai-claim-${key}`,
    validateStatus: errors[key] ? ('error' as const) : undefined,
    help: errors[key] ?? help,
    className: '!mb-2',
  });

  return (
    <Form layout="vertical" size="small" component="div">
      {mode === 'create' ? (
        <Form.Item {...item('title', 'What is the claim for?')}>
          <Input id="ai-claim-title" maxLength={120} value={values.title} onChange={(e) => set('title', e.target.value)} />
        </Form.Item>
      ) : null}
      <Form.Item {...item('date', 'Date')}>
        <DatePicker
          id="ai-claim-date"
          className="w-full"
          format={FORMATS}
          disabledDate={(d) => d.isAfter(dayjs(), 'day') || d.isBefore(earliest, 'day')}
          value={values.date ? dayjs(values.date) : null}
          onChange={(d) => set('date', d ? d.format('YYYY-MM-DD') : '')}
        />
      </Form.Item>
      <Form.Item {...item('categoryId', 'Category')}>
        <Select id="ai-claim-categoryId" value={values.categoryId || undefined} onChange={(v) => set('categoryId', v)} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
      </Form.Item>
      <Form.Item {...item('amountRupees', 'Amount', rule)}>
        <InputNumber id="ai-claim-amountRupees" className="w-full" prefix="₹" min={0} precision={2} value={values.amountRupees} onChange={(v) => set('amountRupees', v ?? null)} />
      </Form.Item>
      <Form.Item {...item('merchant', 'Merchant')}>
        <Input id="ai-claim-merchant" maxLength={120} value={values.merchant} onChange={(e) => set('merchant', e.target.value)} />
      </Form.Item>
      <Form.Item {...item('note', 'Note (optional)')}>
        <Input.TextArea id="ai-claim-note" autoSize={{ minRows: 1, maxRows: 3 }} maxLength={500} value={values.note} onChange={(e) => set('note', e.target.value)} />
      </Form.Item>
      <Form.Item {...item('submitNow', 'Submit now', values.submitNow ? 'Sent to your admin on Confirm.' : 'Kept as a draft, to add more expenses.')}>
        <Switch id="ai-claim-submitNow" size="small" checked={values.submitNow} onChange={(v) => set('submitNow', v)} />
      </Form.Item>
    </Form>
  );
}
