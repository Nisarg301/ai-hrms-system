import { zodResolver } from '@hookform/resolvers/zod';
import { SaveOutlined, UploadOutlined } from '@ant-design/icons';
import { Alert, Form, Input, Modal, Select, Upload, Button } from 'antd';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useAppDispatch } from '../../hooks/store';
import { createDocument, fetchDocuments, updateDocument } from '../../store/documents/documentsThunks';
import { ApiError } from '../../types/api';
import type { DocumentRow } from '../../types/document';
import { applyServerFieldErrors } from '../../utils/applyServerFieldErrors';
import { documentSchema, type DocumentFormValues } from '../../validation/document.schemas';

interface DocumentFormModalProps {
  open: boolean;
  /** null means create. Named `record`, not `document`, so it does not shadow
   * the global DOM `document` inside this component. */
  record: DocumentRow | null;
  onClose: () => void;
}

const EMPTY: DocumentFormValues = { title: '', description: '', category: '', status: 'active', file: undefined };

export function DocumentFormModal({ open, record, onClose }: DocumentFormModalProps) {
  const dispatch = useAppDispatch();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { control, handleSubmit, reset, setError, formState } = useForm<DocumentFormValues>({
    resolver: zodResolver(documentSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    // An existing attachment is shown by name; only a newly picked File is uploaded.
    const existingFileName = record?.file?.originalName;

    reset(
      record
        ? {
          title: record.title,
          description: record.description,
          category: record.category,
          status: record.status,
          file: existingFileName,
        }
        : EMPTY
    );
    setServerError(null);
  }, [open, record, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSubmitting(true);
    const formData = new FormData();
    if (values.file instanceof File) {
      formData.append('file', values.file);
    }
    formData.append('title', values.title);
    formData.append('description', values.description);
    formData.append('category', values.category);
    formData.append('status', values.status);
    const result = record
      ? await dispatch(updateDocument({ id: record.id, payload: formData }))
      : await dispatch(createDocument(formData));
    setSubmitting(false);

    const rejected = record ? updateDocument.rejected.match(result) : createDocument.rejected.match(result);
    if (rejected) {
      const payload = (result as { payload?: { status: number; message: string; details?: unknown } }).payload;
      const reconstructed = payload ? new ApiError(payload.status, payload.message, payload.details) : new ApiError(0, 'Could not save the document');
      const setFormFieldError = setError as (field: string, error: { type: string; message: string }) => void;
      const placed = applyServerFieldErrors(reconstructed, setFormFieldError, ['title', 'description', 'category']);
      if (!placed) {
        setServerError(reconstructed.message);
      }
      return;
    }

    await dispatch(fetchDocuments());
    reset(EMPTY);
    onClose();
  });

  return (
    <Modal
      open={open}
      title={record ? 'Edit document' : 'Add document'}
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
          name="category"
          control={control}
          render={({ field }) => (
            <Form.Item label="Category" htmlFor="category" validateStatus={formState.errors.category ? 'error' : ''} help={formState.errors.category?.message}>
              <Input {...field} id="category" />
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
                  { value: 'archived', label: 'Archived' },
                ]}
              />
            </Form.Item>
          )}
        />
        <Controller
          name="file"
          control={control}
          render={({ field }) => {
            const fileList = field.value
              ? [
                {
                  uid: '-1',
                  name:
                    field.value instanceof File
                      ? field.value.name
                      : typeof field.value === 'string'
                        ? field.value
                        : 'Attached file',
                  status: 'done' as const,
                },
              ]
              : [];

            return (
              <Form.Item label="File" htmlFor="file" validateStatus={formState.errors.file ? 'error' : ''} help={formState.errors.file?.message}>
                <Upload
                  beforeUpload={(file) => {
                    field.onChange(file);
                    return false;
                  }}
                  fileList={fileList}
                  onRemove={() => {
                    field.onChange(undefined);
                  }}
                  maxCount={1}
                >
                  <Button icon={<UploadOutlined />}>Click to Upload</Button>
                </Upload>
              </Form.Item>
            );
          }}
        />
      </Form>
    </Modal>
  );
}
