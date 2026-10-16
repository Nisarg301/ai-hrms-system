import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Form, Input, Typography } from 'antd';
import { LockOutlined, SafetyOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { landingPath } from '../../routes/landingPath';
import { selectAuthUser } from '../../store/auth/authSelectors';
import { changePassword } from '../../store/auth/authThunks';
import { changePasswordSchema, type ChangePasswordFormValues } from '../../validation/auth.schemas';

export default function ChangePasswordPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const user = useAppSelector(selectAuthUser);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { control, handleSubmit, formState } = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { oldPassword: '', newPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSubmitting(true);
    const result = await dispatch(changePassword(values));
    setSubmitting(false);
    if (changePassword.rejected.match(result)) {
      setServerError(result.payload ?? 'Could not change password');
      return;
    }
    navigate(user ? landingPath(user) : '/', { replace: true });
  });

  return (
    <Form layout="vertical" onSubmitCapture={onSubmit}>
      {user?.mustChangePassword ? (
        <Typography.Paragraph type="secondary">
          Your account was created with a temporary password. Choose a new password to continue.
        </Typography.Paragraph>
      ) : null}

      {serverError ? <Alert className="mb-4" type="error" message={serverError} showIcon /> : null}

      <Controller
        name="oldPassword"
        control={control}
        render={({ field }) => (
          <Form.Item
            label="Current password"
            htmlFor="oldPassword"
            validateStatus={formState.errors.oldPassword ? 'error' : ''}
            help={formState.errors.oldPassword?.message}
          >
            <Input.Password {...field} id="oldPassword" autoComplete="current-password" prefix={<LockOutlined />} />
          </Form.Item>
        )}
      />

      <Controller
        name="newPassword"
        control={control}
        render={({ field }) => (
          <Form.Item
            label="New password"
            htmlFor="newPassword"
            validateStatus={formState.errors.newPassword ? 'error' : ''}
            help={formState.errors.newPassword?.message}
          >
            <Input.Password {...field} id="newPassword" autoComplete="new-password" prefix={<LockOutlined />} />
          </Form.Item>
        )}
      />

      <Button type="primary" htmlType="submit" block loading={submitting} icon={<SafetyOutlined />}>
        Change password
      </Button>
    </Form>
  );
}
