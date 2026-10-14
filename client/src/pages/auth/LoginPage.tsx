import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Form, Input } from 'antd';
import { LockOutlined, LoginOutlined, MailOutlined } from '@ant-design/icons';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { ROUTES } from '../../constants/routes';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { landingPath } from '../../routes/landingPath';
import { selectAuthError, selectAuthStatus, selectAuthUser } from '../../store/auth/authSelectors';
import { login } from '../../store/auth/authThunks';
import { loginSchema, type LoginFormValues } from '../../validation/auth.schemas';

export default function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const user = useAppSelector(selectAuthUser);
  const status = useAppSelector(selectAuthStatus);
  const error = useAppSelector(selectAuthError);

  const { control, handleSubmit, formState } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  useEffect(() => {
    if (!user) return;
    // The MustChangePasswordGate would bounce them anyway; routing straight there
    // avoids a visible flash of the landing page.
    navigate(user.mustChangePassword ? ROUTES.changePassword : landingPath(user), { replace: true });
  }, [user, navigate]);

  const onSubmit = handleSubmit((values) => {
    void dispatch(login(values));
  });

  return (
    <Form layout="vertical" onSubmitCapture={onSubmit} noValidate>
      {error ? <Alert className="mb-4" type="error" message={error} showIcon /> : null}

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

      <Controller
        name="password"
        control={control}
        render={({ field }) => (
          <Form.Item
            label="Password"
            htmlFor="password"
            validateStatus={formState.errors.password ? 'error' : ''}
            help={formState.errors.password?.message}
          >
            <Input.Password {...field} id="password" autoComplete="current-password" placeholder="********" prefix={<LockOutlined />} />
          </Form.Item>
        )}
      />

      <Button type="primary" htmlType="submit" block loading={status === 'loading'} icon={<LoginOutlined />}>
        Sign in
      </Button>

      <div className="mt-4 text-center">
        <Link to={ROUTES.forgotPassword}>Forgot password?</Link>
      </div>
    </Form>
  );
}
