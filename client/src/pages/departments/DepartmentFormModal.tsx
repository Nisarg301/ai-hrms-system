import { zodResolver } from '@hookform/resolvers/zod';
import { SaveOutlined } from '@ant-design/icons';
import { Alert, Form, Input, Modal, Select } from 'antd';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useAppDispatch } from '../../hooks/store';
import { createDepartment, fetchDepartments, updateDepartment } from '../../store/departments/departmentsThunks';
import { ApiError } from '../../types/api';
import type { DepartmentRow } from '../../types/department';
import { applyServerFieldErrors } from '../../utils/applyServerFieldErrors';
import { departmentSchema, type DepartmentFormValues } from '../../validation/department.schema';

interface DepartmentFormModalProps {
  open: boolean;
  /** null means create. Named `record`, not `document`, so it does not shadow
   * the global DOM `document` inside this component. */
  record: DepartmentRow | null;
  onClose: () => void;
}

const EMPTY: DepartmentFormValues = { title: '', description: '', status: 'active' };

export function DepartmentFormModal({ open, record, onClose }: DepartmentFormModalProps) {
  const dispatch = useAppDispatch();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { control, handleSubmit, reset, setError, formState } = useForm<DepartmentFormValues>({
    resolver: zodResolver(departmentSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    reset(record ? { title: record.title, description: record.description, status: record.status } : EMPTY);
    setServerError(null);
  }, [open, record, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSubmitting(true);
    const result = record
      ? await dispatch(updateDepartment({ id: record.id, payload: values }))
      : await dispatch(createDepartment(values));
    setSubmitting(false);

    const rejected = record ? updateDepartment.rejected.match(result) : createDepartment.rejected.match(result);
    if (rejected) {
      const payload = (result as { payload?: { status: number; message: string; details?: unknown } }).payload;
      const reconstructed = payload ? new ApiError(payload.status, payload.message, payload.details) : new ApiError(0, 'Could not save the department');
      const setFormFieldError = setError as (field: string, error: { type: string; message: string }) => void;
      const placed = applyServerFieldErrors(reconstructed, setFormFieldError, ['title', 'description']);
      if (!placed) {
        setServerError(reconstructed.message);
      }
      return;
    }

    await dispatch(fetchDepartments());
    reset(EMPTY);
    onClose();
  });

  return (
    <Modal
      open={open}
      title={record ? 'Edit department' : 'Add department'}
      okText="Save"
      onOk={onSubmit}
      okButtonProps={{ icon: <SaveOutlined /> }}
      confirmLoading={submitting}
      onCancel={() => {
        setServerError(null);
        onClose();
      }}
      destroyOnHidden
    >
      <Form layout="vertical">
        {serverError ? <Alert className="mb-4" type="error" message={serverError} showIcon /> : null}

        <Controller
          name="title"
          control={control}
          render={({ field }) => (
            <Form.Item label="Title" htmlFor="title" validateStatus={formState.errors.title ? 'error' : ''} help={formState.errors.title?.message}>
              <Input {...field} id="title" />
            </Form.Item>
          )}
        />
        <Controller
          name="description"
          control={control}
          render={({ field }) => (
            <Form.Item label="Description" htmlFor="description" validateStatus={formState.errors.description ? 'error' : ''} help={formState.errors.description?.message}>
              <Input.TextArea {...field} id="description" rows={3} />
            </Form.Item>
          )}
        />

        <Controller
          name="status"
          control={control}
          render={({ field }) => (
            <Form.Item label="Status" htmlFor="status">
              <Select
                {...field}
                id="status"
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'inactive', label: 'Inactive' },
                ]}
              />
            </Form.Item>
          )}
        />
      </Form>
    </Modal>
  );
}
