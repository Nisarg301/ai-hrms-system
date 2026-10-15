import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Form, Input, message } from 'antd';
import { LockOutlined, SafetyOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ROUTES } from '../../constants/routes';
import { useAppDispatch } from '../../hooks/store';
import { resetPassword } from '../../store/auth/authThunks';
import { resetPasswordSchema, type ResetPasswordFormValues } from '../../validation/auth.schemas';

export default function ResetPasswordPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tokenFromUrl = searchParams.get('token') ?? '';
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { control, handleSubmit, formState } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token: tokenFromUrl, newPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSubmitting(true);
    const result = await dispatch(resetPassword(values));
    setSubmitting(false);
    if (resetPassword.rejected.match(result)) {
      setServerError(result.payload ?? 'Could not reset password');
      return;
    }
    message.success('Password reset. Please sign in with your new password.');
    navigate(ROUTES.login, { replace: true });
  });

  return (
    <Form layout="vertical" onSubmitCapture={onSubmit}>
      {serverError ? <Alert className="mb-4" type="error" message={serverError} showIcon /> : null}

      <Controller
        name="token"
        control={control}
        render={({ field }) => (
          <Form.Item
            label="Reset token"
            htmlFor="token"
            validateStatus={formState.errors.token ? 'error' : ''}
            help={formState.errors.token?.message}
          >
            {/* Read-only when it came from the link, editable when pasted by hand. */}
            <Input {...field} id="token" readOnly={tokenFromUrl.length > 0} />
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
        Reset password
      </Button>

      <div className="mt-4 text-center">
        <Link to={ROUTES.login}>Back to sign in</Link>
      </div>
    </Form>
  );
}
