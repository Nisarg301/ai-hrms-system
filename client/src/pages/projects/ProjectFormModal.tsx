import { zodResolver } from '@hookform/resolvers/zod';
import { SaveOutlined } from '@ant-design/icons';
import { Alert, DatePicker, Form, Input, Modal, Select } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useAppDispatch } from '../../hooks/store';
import { createProject, fetchProjects, updateProject } from '../../store/projects/projectsThunks';
import { ApiError } from '../../types/api';
import type { ProjectRow } from '../../types/project';
import { applyServerFieldErrors } from '../../utils/applyServerFieldErrors';
import { projectSchema, type ProjectFormValues } from '../../validation/project.schemas';

interface ProjectFormModalProps {
  open: boolean;
  /** null means create. */
  record: ProjectRow | null;
  onClose: () => void;
}

const EMPTY: ProjectFormValues = { name: '', description: '', deadline: '', status: 'planning' };

export function ProjectFormModal({ open, record, onClose }: ProjectFormModalProps) {
  const dispatch = useAppDispatch();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { control, handleSubmit, reset, setError, formState } = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    reset(record ? { name: record.name, description: record.description, deadline: record.deadline, status: record.status } : EMPTY);
    setServerError(null);
  }, [open, record, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSubmitting(true);
    const result = record
      ? await dispatch(updateProject({ id: record.id, payload: values }))
      : await dispatch(createProject(values));
    setSubmitting(false);

    const rejected = record ? updateProject.rejected.match(result) : createProject.rejected.match(result);
    if (rejected) {
      const payload = (result as { payload?: { status: number; message: string; details?: unknown } }).payload;
      const reconstructed = payload ? new ApiError(payload.status, payload.message, payload.details) : new ApiError(0, 'Could not save the project');
      const setFormFieldError = setError as (field: string, error: { type: string; message: string }) => void;
      const placed = applyServerFieldErrors(reconstructed, setFormFieldError, ['name', 'description', 'deadline']);
      if (!placed) {
        setServerError(reconstructed.message);
      }
      return;
    }

    await dispatch(fetchProjects());
    reset(EMPTY);
    onClose();
  });

  return (
    <Modal
      open={open}
      title={record ? 'Edit project' : 'Add project'}
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
          name="name"
          control={control}
          render={({ field }) => (
            <Form.Item label="Name" htmlFor="name" validateStatus={formState.errors.name ? 'error' : ''} help={formState.errors.name?.message}>
              <Input {...field} id="name" />
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
          name="deadline"
          control={control}
          render={({ field }) => (
            <Form.Item label="Deadline" htmlFor="deadline" validateStatus={formState.errors.deadline ? 'error' : ''} help={formState.errors.deadline?.message}>
              <DatePicker
                id="deadline"
                style={{ width: '100%' }}
                value={field.value ? dayjs(field.value) : null}
                onChange={(date) => field.onChange(date ? date.toISOString() : '')}
              />
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
                  { value: 'planning', label: 'Planning' },
                  { value: 'active', label: 'Active' },
                  { value: 'completed', label: 'Completed' },
                  { value: 'on-hold', label: 'On Hold' },
                ]}
              />
            </Form.Item>
          )}
        />
      </Form>
    </Modal>
  );
}
