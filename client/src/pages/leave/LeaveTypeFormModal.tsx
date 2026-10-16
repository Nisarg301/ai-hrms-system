import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Form, Input, InputNumber, Modal, Switch } from 'antd';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useAppDispatch } from '../../hooks/store';
import { createLeaveType, updateLeaveType } from '../../store/leaveAdmin/leaveAdminThunks';
import { ApiError } from '../../types/api';
import type { LeaveType } from '../../types/leave';
import { applyServerFieldErrors } from '../../utils/applyServerFieldErrors';
import { leaveTypeSchema, type LeaveTypeFormValues } from '../../validation/leaveType.schema';

const EMPTY: LeaveTypeFormValues = { name: '', code: '', isPaid: true, yearlyQuota: 12, allowHalfDay: true, isActive: true };
const FIELDS = ['name', 'code', 'isPaid', 'yearlyQuota', 'allowHalfDay', 'isActive'];

export function LeaveTypeFormModal({ open, record, onClose }: { open: boolean; record: LeaveType | null; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { control, handleSubmit, reset, setError, formState } = useForm<LeaveTypeFormValues>({
    resolver: zodResolver(leaveTypeSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    reset(record ? { name: record.name, code: record.code, isPaid: record.isPaid, yearlyQuota: record.yearlyQuota, allowHalfDay: record.allowHalfDay, isActive: record.isActive } : EMPTY);
    setServerError(null);
  }, [open, record, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSaving(true);
    const payload = { ...values, code: values.code.toUpperCase() };
    const result = record ? await dispatch(updateLeaveType({ id: record.id, payload })) : await dispatch(createLeaveType(payload));
    setSaving(false);
    if (createLeaveType.rejected.match(result) || updateLeaveType.rejected.match(result)) {
      const p = result.payload;
      const error = p ? new ApiError(p.status, p.message, p.details) : new ApiError(0, 'Could not save the leave type');
      const setFieldError = setError as (field: string, error: { type: string; message: string }) => void;
      if (!applyServerFieldErrors(error, setFieldError, FIELDS)) setServerError(error.message);
      return;
    }
    onClose();
  });

  const errors = formState.errors;
  return (
    <Modal open={open} title={record ? 'Edit leave type' : 'Add leave type'} okText="Save" onOk={onSubmit} confirmLoading={saving} onCancel={onClose} destroyOnHidden>
      <Form layout="vertical">
        {serverError ? <Alert className="mb-4" type="error" showIcon message={serverError} /> : null}
        <div className="flex gap-3">
          <Controller
            name="name"
            control={control}
            render={({ field }) => (
              <Form.Item className="flex-1" label="Name" htmlFor="lt-name" validateStatus={errors.name ? 'error' : ''} help={errors.name?.message}>
                <Input {...field} id="lt-name" placeholder="e.g. Sick Leave" />
              </Form.Item>
            )}
          />
          <Controller
            name="code"
            control={control}
            render={({ field }) => (
              <Form.Item className="w-28" label="Code" htmlFor="lt-code" validateStatus={errors.code ? 'error' : ''} help={errors.code?.message}>
                <Input {...field} id="lt-code" placeholder="SL" maxLength={6} onChange={(e) => field.onChange(e.target.value.toUpperCase())} />
              </Form.Item>
            )}
          />
        </div>
        <Controller
          name="yearlyQuota"
          control={control}
          render={({ field }) => (
            <Form.Item
              label="Days per year"
              htmlFor="lt-quota"
              validateStatus={errors.yearlyQuota ? 'error' : ''}
              help={errors.yearlyQuota?.message ?? 'Leave empty for unlimited (e.g. unpaid leave).'}
            >
              <InputNumber id="lt-quota" className="w-full" min={0} max={366} precision={0} placeholder="Unlimited" value={field.value} onChange={(v) => field.onChange(v ?? null)} />
            </Form.Item>
          )}
        />
        <div className="flex flex-wrap gap-6">
          {(
            [
              ['isPaid', 'Paid'],
              ['allowHalfDay', 'Half days allowed'],
              ['isActive', 'Active'],
            ] as const
          ).map(([name, label]) => (
            <Controller
              key={name}
              name={name}
              control={control}
              render={({ field }) => (
                <Form.Item label={label} htmlFor={`lt-${name}`}>
                  <Switch id={`lt-${name}`} checked={field.value} onChange={field.onChange} />
                </Form.Item>
              )}
            />
          ))}
        </div>
      </Form>
    </Modal>
  );
}
