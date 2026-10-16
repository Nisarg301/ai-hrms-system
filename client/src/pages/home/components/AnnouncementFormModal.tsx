import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Checkbox, DatePicker, Form, Input, Modal } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useAppDispatch } from '../../../hooks/store';
import { createAnnouncement, fetchHomeSummary, updateAnnouncement } from '../../../store/home/homeThunks';
import { ApiError } from '../../../types/api';
import type { Announcement } from '../../../types/announcement';
import { applyServerFieldErrors } from '../../../utils/applyServerFieldErrors';
import { announcementSchema, type AnnouncementFormValues } from '../../../validation/announcement.schema';

interface AnnouncementFormModalProps {
  open: boolean;
  /** null means create. */
  record: Announcement | null;
  onClose: () => void;
}

const EMPTY: AnnouncementFormValues = { title: '', body: '', pinned: false, expiresOn: null };
const FIELDS = ['title', 'body', 'pinned', 'expiresOn'];

export function AnnouncementFormModal({ open, record, onClose }: AnnouncementFormModalProps) {
  const dispatch = useAppDispatch();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { control, handleSubmit, reset, setError, formState } = useForm<AnnouncementFormValues>({
    resolver: zodResolver(announcementSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    reset(record ? { title: record.title, body: record.body, pinned: record.pinned, expiresOn: record.expiresOn } : EMPTY);
    setServerError(null);
  }, [open, record, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSubmitting(true);
    const result = record ? await dispatch(updateAnnouncement({ id: record.id, payload: values })) : await dispatch(createAnnouncement(values));
    setSubmitting(false);

    if (createAnnouncement.rejected.match(result) || updateAnnouncement.rejected.match(result)) {
      const payload = result.payload;
      const error = payload ? new ApiError(payload.status, payload.message, payload.details) : new ApiError(0, 'Could not save the announcement');
      const setFieldError = setError as (field: string, error: { type: string; message: string }) => void;
      if (!applyServerFieldErrors(error, setFieldError, FIELDS)) {
        setServerError(error.message);
      }
      return;
    }
    void dispatch(fetchHomeSummary());
    onClose();
  });

  const errors = formState.errors;
  return (
    <Modal
      open={open}
      title={record ? 'Edit announcement' : 'New announcement'}
      okText={record ? 'Save' : 'Publish'}
      onOk={onSubmit}
      confirmLoading={submitting}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form layout="vertical">
        {serverError ? <Alert className="mb-4" type="error" message={serverError} showIcon /> : null}
        <Controller
          name="title"
          control={control}
          render={({ field }) => (
            <Form.Item label="Title" htmlFor="announcement-title" validateStatus={errors.title ? 'error' : ''} help={errors.title?.message}>
              <Input {...field} id="announcement-title" maxLength={150} placeholder="e.g. Office closed on Friday" />
            </Form.Item>
          )}
        />
        <Controller
          name="body"
          control={control}
          render={({ field }) => (
            <Form.Item label="Message" htmlFor="announcement-body" validateStatus={errors.body ? 'error' : ''} help={errors.body?.message}>
              <Input.TextArea {...field} id="announcement-body" rows={5} maxLength={5000} showCount />
            </Form.Item>
          )}
        />
        <Controller
          name="expiresOn"
          control={control}
          render={({ field }) => (
            <Form.Item
              label="Show until (optional)"
              htmlFor="announcement-expires"
              validateStatus={errors.expiresOn ? 'error' : ''}
              help={errors.expiresOn?.message ?? 'Leave empty to keep it up until you remove it.'}
            >
              <DatePicker
                id="announcement-expires"
                className="w-full"
                format="DD MMM YYYY"
                value={field.value ? dayjs(field.value) : null}
                onChange={(value) => field.onChange(value ? value.format('YYYY-MM-DD') : null)}
                disabledDate={(d) => d.isBefore(dayjs(), 'day')}
              />
            </Form.Item>
          )}
        />
        <Controller
          name="pinned"
          control={control}
          render={({ field }) => (
            <Checkbox checked={field.value} onChange={(e) => field.onChange(e.target.checked)}>
              Pin to the top
            </Checkbox>
          )}
        />
      </Form>
    </Modal>
  );
}
