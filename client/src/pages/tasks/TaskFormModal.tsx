import { zodResolver } from '@hookform/resolvers/zod';
import { SaveOutlined } from '@ant-design/icons';
import { Alert, DatePicker, Form, Input, Modal, Select, } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { createTask, fetchTasks, updateTask } from '../../store/tasks/tasksThunks';
import { ApiError } from '../../types/api';
import type { TaskRow } from '../../types/task';
import { applyServerFieldErrors } from '../../utils/applyServerFieldErrors';
import { taskSchema, type TaskFormValues } from '../../validation/task.schemas';
import { selectAllProjects } from '../../store/projects/projectsSelectors'
import { selectAllEmployees } from '../../store/employees/employeesSelectors';
import { fetchAllProjects } from '../../store/projects/projectsThunks';
import { fetchAllEmployees } from '../../store/employees/employeesThunks'

interface TaskFormModalProps {
  open: boolean;
  /** null means create. */
  record: TaskRow | null;
  onClose: () => void;
}

const EMPTY: TaskFormValues = { title: '', description: '', dueDate: '', status: 'todo', projectId: '', userId: [] };

export function TaskFormModal({ open, record, onClose }: TaskFormModalProps) {
  const dispatch = useAppDispatch();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const projects = useAppSelector(selectAllProjects);
  const employees = useAppSelector(selectAllEmployees);

  const { control, handleSubmit, reset, setError, formState } = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    reset(
      record
        ? {
            title: record.title,
            description: record.description,
            dueDate: record.dueDate,
            status: record.status,
            projectId: record.projectId || '',
            userId: Array.isArray(record.userId)
              ? record.userId
              : typeof record.userId === 'string' && record.userId
              ? (record.userId as string).split(',')
              : [],
          }
        : EMPTY
    );
    setServerError(null);
    void dispatch(fetchAllProjects());
    void dispatch(fetchAllEmployees());

  }, [open, record, reset, dispatch]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSubmitting(true);

    const result = record
      ? await dispatch(updateTask({ id: record.id, payload: values }))
      : await dispatch(createTask(values));
    setSubmitting(false);

    const rejected = record ? updateTask.rejected.match(result) : createTask.rejected.match(result);
    if (rejected) {
      const payload = (result as { payload?: { status: number; message: string; details?: unknown } }).payload;
      const reconstructed = payload ? new ApiError(payload.status, payload.message, payload.details) : new ApiError(0, 'Could not save the task');
      const setFormFieldError = setError as (field: string, error: { type: string; message: string }) => void;
      const placed = applyServerFieldErrors(reconstructed, setFormFieldError, ['title', 'description', 'dueDate', 'projectId', 'status', 'userId']);
      if (!placed) {
        setServerError(reconstructed.message);
      }
      return;
    }

    await dispatch(fetchTasks());
    reset(EMPTY);
    onClose();
  });

  return (
    <Modal
      open={open}
      title={record ? 'Edit task' : 'Add task'}
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
          name="dueDate"
          control={control}
          render={({ field }) => (
            <Form.Item label="Due date" htmlFor="dueDate" validateStatus={formState.errors.dueDate ? 'error' : ''} help={formState.errors.dueDate?.message}>
              <DatePicker
                id="dueDate"
                style={{ width: '100%' }}
                value={field.value ? dayjs(field.value) : null}
                onChange={(date) => field.onChange(date ? date.format('YYYY-MM-DD') : '')}
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
                  { value: 'todo', label: 'To Do' },
                  { value: 'in-progress', label: 'In Progress' },
                  { value: 'done', label: 'Done' },
                  { value: 'blocked', label: 'Blocked' },
                ]}
              />
            </Form.Item>
          )}
        />
        <Controller
          name="projectId"
          control={control}
          render={({ field }) => (
            <Form.Item label="Project" htmlFor="projectId" validateStatus={formState.errors.projectId ? 'error' : ''} help={formState.errors.projectId?.message}>
              <Select
                {...field}
                id="projectId"
                options={projects.map((p) => {
                  return {
                    value: p.id,
                    label: p.name
                  }
                })}
              />
            </Form.Item>
          )}
        />
        <Controller
          name="userId"
          control={control}
          render={({ field }) => (
            <Form.Item label="Members" htmlFor="userId" validateStatus={formState.errors.userId ? 'error' : ''} help={formState.errors.userId?.message}>
              <Select
                id="userId"
                mode='multiple'
                value={field.value}
                onChange={field.onChange}
                options={employees.map((p) => {
                  return {
                    value: p.id,
                    label: p.name
                  }
                })}
              />
            </Form.Item>
          )}
        />
      </Form>
    </Modal>
  );
}
