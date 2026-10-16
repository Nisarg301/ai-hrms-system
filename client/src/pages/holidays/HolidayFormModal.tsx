import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, DatePicker, Form, Input, Modal } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useAppDispatch } from '../../hooks/store';
import { createHoliday, fetchHolidays, updateHoliday } from '../../store/holidays/holidaysThunks';
import { ApiError } from '../../types/api';
import type { Holiday } from '../../types/holiday';
import { applyServerFieldErrors } from '../../utils/applyServerFieldErrors';
import { holidaySchema, type HolidayFormValues } from '../../validation/holiday.schema';

const EMPTY: HolidayFormValues = { name: '', date: '', description: '' };

interface HolidayFormModalProps {
  open: boolean;
  record: Holiday | null;
  /** The year on screen, reloaded after saving. */
  year: number;
  onClose: () => void;
}

export function HolidayFormModal({ open, record, year, onClose }: HolidayFormModalProps) {
  const dispatch = useAppDispatch();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { control, handleSubmit, reset, setError, formState } = useForm<HolidayFormValues>({
    resolver: zodResolver(holidaySchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    reset(record ? { name: record.name, date: record.date, description: record.description } : EMPTY);
    setServerError(null);
  }, [open, record, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSaving(true);
    const result = record ? await dispatch(updateHoliday({ id: record.id, payload: values })) : await dispatch(createHoliday(values));
    setSaving(false);
    if (createHoliday.rejected.match(result) || updateHoliday.rejected.match(result)) {
      const p = result.payload;
      const error = p ? new ApiError(p.status, p.message, p.details) : new ApiError(0, 'Could not save the holiday');
      const setFieldError = setError as (field: string, error: { type: string; message: string }) => void;
      if (!applyServerFieldErrors(error, setFieldError, ['name', 'date', 'description'])) setServerError(error.message);
      return;
    }
    void dispatch(fetchHolidays(year));
    onClose();
  });

  const errors = formState.errors;
  return (
    <Modal open={open} title={record ? 'Edit holiday' : 'Add holiday'} okText="Save" onOk={onSubmit} confirmLoading={saving} onCancel={onClose} destroyOnHidden>
      <Form layout="vertical">
        {serverError ? <Alert className="mb-4" type="error" showIcon message={serverError} /> : null}
        <Controller
          name="name"
          control={control}
          render={({ field }) => (
            <Form.Item label="Name" htmlFor="holiday-name" validateStatus={errors.name ? 'error' : ''} help={errors.name?.message}>
              <Input {...field} id="holiday-name" placeholder="e.g. Diwali" />
            </Form.Item>
          )}
        />
        <Controller
          name="date"
          control={control}
          render={({ field }) => (
            <Form.Item label="Date" htmlFor="holiday-date" validateStatus={errors.date ? 'error' : ''} help={errors.date?.message}>
              <DatePicker
                id="holiday-date"
                className="w-full"
                format={['DD MMM YYYY', 'YYYY-MM-DD']}
                value={field.value ? dayjs(field.value) : null}
                onChange={(d) => field.onChange(d ? d.format('YYYY-MM-DD') : '')}
              />
            </Form.Item>
          )}
        />
        <Controller
          name="description"
          control={control}
          render={({ field }) => (
            <Form.Item label="Description (optional)" htmlFor="holiday-description" validateStatus={errors.description ? 'error' : ''} help={errors.description?.message}>
              <Input.TextArea {...field} id="holiday-description" rows={2} maxLength={500} />
            </Form.Item>
          )}
        />
      </Form>
    </Modal>
  );
}
