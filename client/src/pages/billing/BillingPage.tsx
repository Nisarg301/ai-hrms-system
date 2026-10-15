import { ArrowLeftOutlined, LogoutOutlined } from '@ant-design/icons';
import { Alert, Button, Layout, Skeleton, Typography, message, theme } from 'antd';
import dayjs from 'dayjs';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrandMark } from '../../components/BrandMark/BrandMark';
import { confirmAction } from '../../components/ConfirmDialog/confirmDialog';
import { PlanCatalog } from '../../components/PlanCatalog/PlanCatalog';
import { PLAN_NAMES } from '../../constants/modules';
import { BILLING_CYCLE_LABELS } from '../../constants/plans';
import { ROUTES } from '../../constants/routes';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { landingPath } from '../../routes/landingPath';
import { createOrderRequest, listPlansRequest, verifyPaymentRequest } from '../../services/endpoints/subscription.endpoints';
import { selectAuthUser } from '../../store/auth/authSelectors';
import { logout, refreshCurrentUser } from '../../store/auth/authThunks';
import { ApiError } from '../../types/api';
import type { RazorpaySuccessResponse } from '../../types/razorpay';
import type { BillingCycle, PlanDefinition, PlanType } from '../../types/subscription';
import { loadRazorpay } from '../../utils/loadRazorpay';

function formatDate(iso: string): string {
  return dayjs(iso).format('D MMM YYYY');
}

/**
 * Plan selection and Razorpay payment for an ORG_ADMIN. Standalone (no sidebar):
 * it's where PlanGate sends an admin without an active plan, and also where an
 * admin renews or changes plan from the user menu.
 */
export default function BillingPage() {
  const user = useAppSelector(selectAuthUser);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { token } = theme.useToken();

  const subscription = user?.subscription ?? null;
  const [plans, setPlans] = useState<PlanDefinition[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>(subscription?.billingCycle ?? 'monthly');
  const [busyPlan, setBusyPlan] = useState<PlanType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPlans = useCallback(async () => {
    setLoadError(null);
    try {
      const { data } = await listPlansRequest();
      setPlans(data);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load plans');
    }
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  const completePayment = async (response: RazorpaySuccessResponse) => {
    try {
      await verifyPaymentRequest(response);
    } catch {
      setError(`Your payment was received but could not be verified. Please contact support with payment ID ${response.razorpay_payment_id}.`);
      setBusyPlan(null);
      return;
    }
    const refreshed = await dispatch(refreshCurrentUser());
    setBusyPlan(null);
    if (refreshCurrentUser.fulfilled.match(refreshed)) {
      message.success('Payment successful. Your plan is active.');
      navigate(landingPath(refreshed.payload), { replace: true });
    } else {
      setError('Your payment went through, but your account could not be refreshed. Reload the page to continue.');
    }
  };

  const startCheckout = async (plan: PlanDefinition) => {
    if (!user) return;
    setBusyPlan(plan.type);
    try {
      const { data: order } = await createOrderRequest({ planType: plan.type, billingCycle: cycle });
      if (!(await loadRazorpay()) || !window.Razorpay) {
        setError('Could not load the payment window. Check your connection and try again.');
        setBusyPlan(null);
        return;
      }
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: 'Sentinel',
        description: `${plan.name} plan · ${BILLING_CYCLE_LABELS[cycle]}`,
        prefill: { name: user.name, email: user.email },
        theme: { color: token.colorPrimary },
        handler: (response) => {
          void completePayment(response);
        },
        modal: { ondismiss: () => setBusyPlan(null) },
      });
      checkout.on('payment.failed', (response) => {
        setError(response.error.description || 'The payment failed. Please try again.');
        setBusyPlan(null);
      });
      checkout.open();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the payment. Please try again.');
      setBusyPlan(null);
    }
  };

  const choose = (plan: PlanDefinition) => {
    setError(null);
    const downgrade = subscription?.active && subscription.planType === 'professional' && plan.type === 'basic';
    if (downgrade) {
      confirmAction({
        title: 'Switch to Basic?',
        content:
          'Basic starts a new billing period right away. Your remaining Professional time is not refunded, and Exports and Audit Logs will no longer be available.',
        okText: 'Continue to payment',
        onConfirm: () => {
          void startCheckout(plan);
        },
      });
      return;
    }
    void startCheckout(plan);
  };

  const onSignOut = async () => {
    await dispatch(logout());
    navigate(ROUTES.login, { replace: true });
  };

  const notice = !subscription?.active
    ? subscription?.planType && subscription.expiryDate
      ? { type: 'warning' as const, text: `Your ${PLAN_NAMES[subscription.planType]} plan expired on ${formatDate(subscription.expiryDate)}. Choose a plan to continue.` }
      : { type: 'info' as const, text: 'Your organization needs an active plan to continue. Choose a plan below.' }
    : {
        type: 'success' as const,
        text: `You're on the ${PLAN_NAMES[subscription.planType!]} plan (${BILLING_CYCLE_LABELS[subscription.billingCycle!].toLowerCase()}), active until ${formatDate(subscription.expiryDate!)}. Renewing adds time to the current period.`,
      };

  return (
    <Layout className="min-h-screen" style={{ background: token.colorBgLayout }}>
      <Layout.Header
        className="flex items-center justify-between gap-3 px-4"
        style={{ background: token.colorBgContainer, borderBottom: `1px solid ${token.colorBorderSecondary}` }}
      >
        <BrandMark variant="default" />
        <div className="flex items-center gap-2">
          {subscription?.active && user ? (
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(landingPath(user))}>
              Back to Home
            </Button>
          ) : null}
          <Button type="text" icon={<LogoutOutlined />} onClick={() => void onSignOut()}>
            Sign out
          </Button>
        </div>
      </Layout.Header>

      <Layout.Content className="mx-auto w-full max-w-4xl px-4 py-8">
        <div className="mb-6 text-center">
          <Typography.Title level={2} className="!mb-2">
            Billing &amp; plan
          </Typography.Title>
          <Typography.Text type="secondary">Prices in INR. Pay securely with Razorpay.</Typography.Text>
        </div>

        <Alert className="mb-4" type={notice.type} message={notice.text} showIcon />
        {error ? <Alert className="mb-4" type="error" message={error} showIcon closable onClose={() => setError(null)} /> : null}

        {loadError ? (
          <Alert
            type="error"
            message={loadError}
            showIcon
            action={
              <Button size="small" onClick={() => void loadPlans()}>
                Retry
              </Button>
            }
          />
        ) : plans ? (
          <PlanCatalog
            plans={plans}
            cycle={cycle}
            onCycleChange={setCycle}
            currentPlanType={subscription?.active ? subscription.planType : null}
            onChoose={choose}
            busyPlan={busyPlan}
          />
        ) : (
          <Skeleton active paragraph={{ rows: 8 }} />
        )}
      </Layout.Content>
    </Layout>
  );
}
