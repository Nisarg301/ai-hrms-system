import { Alert, Button, DatePicker, Form, Input, InputNumber, Select, Space } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import type { ExpenseCategory, ExpenseItem, ExpenseItemPayload } from '../../types/expense';
import { MAX_EXPENSE_AGE_DAYS, toPaise } from '../../utils/expenseFormat';
import { formatInrExact } from '../../utils/formatInr';

interface ExpenseItemFormProps {
  categories: ExpenseCategory[];
  initial?: ExpenseItem | null;
  saving: boolean;
  /** Field errors from the server, e.g. { date: "…" }. */
  serverErrors?: Record<string, string>;
  onSave: (payload: ExpenseItemPayload) => void;
  onCancel: () => void;
}

/** Add or edit one expense. Amounts are typed in rupees and sent in paise. */
export function ExpenseItemForm({ categories, initial, saving, serverErrors = {}, onSave, onCancel }: ExpenseItemFormProps) {
  const [date, setDate] = useState<string | null>(initial?.date ?? null);
  const [categoryId, setCategoryId] = useState<string | undefined>(initial?.categoryId);
  const [rupees, setRupees] = useState<number | null>(initial ? initial.amountPaise / 100 : null);
  const [merchant, setMerchant] = useState(initial?.merchant ?? '');
  const [note, setNote] = useState(initial?.note ?? '');

  const today = dayjs();
  const earliest = today.subtract(MAX_EXPENSE_AGE_DAYS, 'day');
  const outOfRange = (d: Dayjs) => d.isAfter(today, 'day') || d.isBefore(earliest, 'day');
  const category = categories.find((c) => c.id === categoryId) ?? null;
  const paise = rupees !== null ? toPaise(rupees) : null;
  const overLimit = category?.limitPaise != null && paise !== null && paise > category.limitPaise;
  const needsReceipt = category !== null && paise !== null && paise > category.receiptRequiredAbovePaise;
  const ready = Boolean(date && categoryId && paise && paise > 0 && merchant.trim());

  const field = (name: string) => (serverErrors[name] ? { validateStatus: 'error' as const, help: serverErrors[name] } : {});

  return (
    <Form layout="vertical" className="rounded-lg border p-4" data-testid="expense-item-form">
      <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
        <Form.Item label="Date" htmlFor="exp-date" {...field('date')}>
          <DatePicker
            id="exp-date"
            className="w-full"
            format={['DD MMM YYYY', 'YYYY-MM-DD']}
            disabledDate={outOfRange}
            value={date ? dayjs(date) : null}
            // Typed dates get past disabledDate on Enter, so check here too.
            onChange={(d) => setDate(d && !outOfRange(d) ? d.format('YYYY-MM-DD') : null)}
          />
        </Form.Item>
        <Form.Item label="Category" htmlFor="exp-category" {...field('categoryId')}>
          <Select
            id="exp-category"
            placeholder="Choose a category"
            value={categoryId}
            onChange={setCategoryId}
            options={[
              ...categories.map((c) => ({
                value: c.id,
                label: c.limitPaise != null ? `${c.name} · limit ${formatInrExact(c.limitPaise)}` : c.name,
              })),
              // An expense saved under a category that has since been switched off.
              ...(initial && !categories.some((c) => c.id === initial.categoryId)
                ? [{ value: initial.categoryId, label: `${initial.categoryName ?? 'Unknown category'} (no longer available)`, disabled: true }]
                : []),
            ]}
          />
        </Form.Item>
        <Form.Item label="Amount" htmlFor="exp-amount" {...field('amountPaise')}>
          <InputNumber
            id="exp-amount"
            className="w-full"
            prefix="₹"
            min={0.01}
            max={1000000}
            precision={2}
            value={rupees}
            onChange={(v) => setRupees(v)}
          />
        </Form.Item>
        <Form.Item label="Merchant" htmlFor="exp-merchant" {...field('merchant')}>
          <Input id="exp-merchant" maxLength={120} placeholder="e.g. Uber, Taj Hotel" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
        </Form.Item>
      </div>
      <Form.Item label="Note (optional)" htmlFor="exp-note">
        <Input.TextArea id="exp-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Form.Item>
      {overLimit ? (
        <Alert
          className="mb-3"
          type="warning"
          showIcon
          message={`Over the ${formatInrExact(category!.limitPaise!)} limit for ${category!.name}. You can still claim it; your approver will see it's over.`}
        />
      ) : null}
      {needsReceipt ? <Alert className="mb-3" type="info" showIcon message="This amount needs a receipt. Add it after saving." /> : null}
      <Space>
        <Button
          type="primary"
          loading={saving}
          disabled={!ready}
          onClick={() => onSave({ date: date!, categoryId: categoryId!, amountPaise: paise!, merchant: merchant.trim(), note: note.trim() })}
        >
          {initial ? 'Save expense' : 'Add expense'}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </Space>
    </Form>
  );
}
