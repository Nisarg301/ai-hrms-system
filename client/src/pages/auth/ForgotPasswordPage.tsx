import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Form, Input, Typography } from 'antd';
import { MailOutlined, SendOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { ROUTES } from '../../constants/routes';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { resetTokenCleared } from '../../store/auth/authSlice';
import { selectResetToken } from '../../store/auth/authSelectors';
import { forgotPassword } from '../../store/auth/authThunks';
import { forgotPasswordSchema, type ForgotPasswordFormValues } from '../../validation/auth.schemas';

export default function ForgotPasswordPage() {
  const dispatch = useAppDispatch();
  const resetToken = useAppSelector(selectResetToken);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => () => void dispatch(resetTokenCleared()), [dispatch]);

  const { control, handleSubmit, formState } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    await dispatch(forgotPassword(values));
    setSubmitting(false);
    setSubmitted(true);
  });

  if (submitted) {
    return (
      <div>
        {/* Identical wording whether or not the account exists — the page must not
            become a user-enumeration oracle beyond what the API already reveals. */}
        <Alert
          type="success"
          showIcon
          message="If that email exists, a password reset has been issued."
        />
        {resetToken ? (
          <div className="mt-4">
            <Typography.Paragraph type="warning">
              Email delivery is not wired up yet, so the reset token is shown here instead of being emailed.
            </Typography.Paragraph>
            <Typography.Paragraph copyable={{ text: resetToken }} className="break-all">
              <code>{resetToken}</code>
            </Typography.Paragraph>
            <Link to={`${ROUTES.resetPassword}?token=${resetToken}`}>Continue to reset password</Link>
          </div>
        ) : null}
        <div className="mt-4">
          <Link to={ROUTES.login}>Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <Form layout="vertical" onSubmitCapture={onSubmit} noValidate>
      <Controller
        name="email"
        control={control}
        render={({ field }) => (
          <Form.Item
            label="Email"
            htmlFor="email"
            validateStatus={formState.errors.email ? 'error' : ''}
            help={formState.errors.email?.message}
          >
            <Input {...field} id="email" type="email" autoComplete="email" placeholder="you@example.com" prefix={<MailOutlined />} />
          </Form.Item>
        )}
      />

      <Button type="primary" htmlType="submit" block loading={submitting} icon={<SendOutlined />}>
        Send reset link
      </Button>

      <div className="mt-4 text-center">
        <Link to={ROUTES.login}>Back to sign in</Link>
      </div>
    </Form>
  );
}
