import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Form, Input, InputNumber, Modal, Switch } from 'antd';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useAppDispatch } from '../../hooks/store';
import { saveCategory } from '../../store/expensesAdmin/expensesAdminThunks';
import { ApiError } from '../../types/api';
import type { ExpenseCategory } from '../../types/expense';
import { applyServerFieldErrors } from '../../utils/applyServerFieldErrors';
import { toPaise } from '../../utils/expenseFormat';
import { expenseCategorySchema, type ExpenseCategoryFormValues } from '../../validation/expenseCategory.schema';

const EMPTY: ExpenseCategoryFormValues = { name: '', limitRupees: null, receiptAboveRupees: 500, isActive: true };
/** The server names the amount fields in paise; the form has them in rupees. */
const SERVER_FIELDS: Record<string, keyof ExpenseCategoryFormValues> = {
  name: 'name',
  limitPaise: 'limitRupees',
  receiptRequiredAbovePaise: 'receiptAboveRupees',
  isActive: 'isActive',
};

export function CategoryFormModal({ open, record, onClose }: { open: boolean; record: ExpenseCategory | null; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { control, handleSubmit, reset, setError, formState } = useForm<ExpenseCategoryFormValues>({
    resolver: zodResolver(expenseCategorySchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    reset(
      record
        ? {
            name: record.name,
            limitRupees: record.limitPaise === null ? null : record.limitPaise / 100,
            receiptAboveRupees: record.receiptRequiredAbovePaise / 100,
            isActive: record.isActive,
          }
        : EMPTY
    );
    setServerError(null);
  }, [open, record, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSaving(true);
    const payload = {
      name: values.name.trim(),
      limitPaise: values.limitRupees === null ? null : toPaise(values.limitRupees),
      receiptRequiredAbovePaise: toPaise(values.receiptAboveRupees),
      isActive: values.isActive,
    };
    const result = await dispatch(saveCategory({ id: record?.id ?? null, payload }));
    setSaving(false);
    if (saveCategory.rejected.match(result)) {
      const p = result.payload;
      const error = p ? new ApiError(p.status, p.message, p.details) : new ApiError(0, 'Could not save the category');
      const setFieldError = (field: string, e: { type: string; message: string }) => setError(SERVER_FIELDS[field], e);
      if (!applyServerFieldErrors(error, setFieldError, Object.keys(SERVER_FIELDS))) setServerError(error.message);
      return;
    }
    onClose();
  });

  const errors = formState.errors;
  return (
    <Modal open={open} title={record ? 'Edit category' : 'New category'} okText="Save" onOk={onSubmit} confirmLoading={saving} onCancel={onClose} destroyOnHidden>
      <Form layout="vertical">
        {serverError ? <Alert className="mb-4" type="error" showIcon message={serverError} /> : null}
        <Controller
          name="name"
          control={control}
          render={({ field }) => (
            <Form.Item label="Name" htmlFor="cat-name" validateStatus={errors.name ? 'error' : ''} help={errors.name?.message}>
              <Input {...field} id="cat-name" placeholder="e.g. Client entertainment" maxLength={60} />
            </Form.Item>
          )}
        />
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
          <Controller
            name="limitRupees"
            control={control}
            render={({ field }) => (
              <Form.Item
                label="Limit per expense"
                htmlFor="cat-limit"
                validateStatus={errors.limitRupees ? 'error' : ''}
                help={errors.limitRupees?.message ?? 'Empty for no limit. Over it is allowed, but flagged.'}
              >
                <InputNumber id="cat-limit" className="w-full" prefix="₹" min={0} precision={2} placeholder="No limit" value={field.value} onChange={(v) => field.onChange(v ?? null)} />
              </Form.Item>
            )}
          />
          <Controller
            name="receiptAboveRupees"
            control={control}
            render={({ field }) => (
              <Form.Item
                label="Receipt needed above"
                htmlFor="cat-receipt"
                validateStatus={errors.receiptAboveRupees ? 'error' : ''}
                help={errors.receiptAboveRupees?.message ?? '0 means a receipt is always needed.'}
              >
                <InputNumber
                  id="cat-receipt"
                  className="w-full"
                  prefix="₹"
                  min={0}
                  precision={2}
                  value={field.value}
                  // Cleared: leave it to the schema to say so.
                  onChange={(v) => field.onChange(v ?? undefined)}
                />
              </Form.Item>
            )}
          />
        </div>
        <Controller
          name="isActive"
          control={control}
          render={({ field }) => (
            <Form.Item label="Active" htmlFor="cat-active" help="Inactive categories can't be chosen for new expenses.">
              <Switch id="cat-active" checked={field.value} onChange={field.onChange} />
            </Form.Item>
          )}
        />
      </Form>
    </Modal>
  );
}
