import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Form, Input, Modal } from 'antd';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useAppDispatch } from '../../../hooks/store';
import { fetchIntroductions, saveMyIntroduction } from '../../../store/people/peopleThunks';
import { ApiError } from '../../../types/api';
import type { Introduction } from '../../../types/people';
import { applyServerFieldErrors } from '../../../utils/applyServerFieldErrors';
import { introductionSchema, type IntroductionFormValues } from '../../../validation/introduction.schema';
import { INTRODUCTION_QUESTIONS } from './introductionQuestions';

interface IntroductionFormModalProps {
  open: boolean;
  initial: Introduction | null;
  onClose: () => void;
}

const EMPTY: IntroductionFormValues = { about: '', hobbies: '', lovesAboutJob: '' };

export function IntroductionFormModal({ open, initial, onClose }: IntroductionFormModalProps) {
  const dispatch = useAppDispatch();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { control, handleSubmit, reset, setError, formState } = useForm<IntroductionFormValues>({
    resolver: zodResolver(introductionSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    reset(initial ?? EMPTY);
    setServerError(null);
  }, [open, initial, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSaving(true);
    const result = await dispatch(saveMyIntroduction(values));
    setSaving(false);
    if (saveMyIntroduction.rejected.match(result)) {
      const p = result.payload;
      const error = p ? new ApiError(p.status, p.message, p.details) : new ApiError(0, 'Could not save your introduction');
      const setFieldError = setError as (field: string, error: { type: string; message: string }) => void;
      if (!applyServerFieldErrors(error, setFieldError, ['about', 'hobbies', 'lovesAboutJob'])) {
        setServerError(error.message);
      }
      return;
    }
    // So my card shows up (or updates) among everyone else's.
    void dispatch(fetchIntroductions());
    onClose();
  });

  return (
    <Modal open={open} title="Introduce yourself" okText="Save" onOk={onSubmit} confirmLoading={saving} onCancel={onClose} destroyOnHidden>
      <p className="mb-4 opacity-70">A few lines help colleagues get to know you. Everyone in your organization can read this.</p>
      <Form layout="vertical">
        {serverError ? <Alert className="mb-4" type="error" message={serverError} showIcon /> : null}
        {INTRODUCTION_QUESTIONS.map((q) => (
          <Controller
            key={q.key}
            name={q.key}
            control={control}
            render={({ field }) => (
              <Form.Item
                label={q.title}
                htmlFor={`intro-${q.key}`}
                validateStatus={formState.errors[q.key] ? 'error' : ''}
                help={formState.errors[q.key]?.message}
              >
                <Input.TextArea {...field} id={`intro-${q.key}`} rows={3} maxLength={1000} showCount placeholder={q.placeholder} />
              </Form.Item>
            )}
          />
        ))}
      </Form>
    </Modal>
  );
}
