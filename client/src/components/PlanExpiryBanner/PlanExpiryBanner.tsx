import { Alert, Button } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PLAN_NAMES } from '../../constants/modules';
import { PLAN_REMINDER_DAYS } from '../../constants/plans';
import { ROUTES } from '../../constants/routes';
import { useAppSelector } from '../../hooks/store';
import { selectAuthUser } from '../../store/auth/authSelectors';

const DAY_MS = 24 * 60 * 60 * 1000;

function dismissKey(expiryDate: string): string {
  return `dismissedPlanReminder:${expiryDate}`;
}

function wasDismissed(expiryDate: string): boolean {
  try {
    return sessionStorage.getItem(dismissKey(expiryDate)) === '1';
  } catch {
    return false;
  }
}

/**
 * Warns an ORG_ADMIN that the plan ends within PLAN_REMINDER_DAYS (the same
 * window as the reminder email). Dismissing hides it for this browser session;
 * the key includes the expiry date, so a renewal's new period can show it again.
 */
export function PlanExpiryBanner() {
  const user = useAppSelector(selectAuthUser);
  const navigate = useNavigate();
  const subscription = user?.subscription;
  const expiryDate = subscription?.expiryDate ?? null;
  const [dismissed, setDismissed] = useState(() => (expiryDate ? wasDismissed(expiryDate) : false));

  if (user?.role !== 'ORG_ADMIN' || !subscription?.active || !subscription.planType || !expiryDate || dismissed) {
    return null;
  }
  const msLeft = new Date(expiryDate).getTime() - Date.now();
  if (msLeft > PLAN_REMINDER_DAYS * DAY_MS) {
    return null;
  }
  const daysLeft = Math.max(1, Math.ceil(msLeft / DAY_MS));

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(dismissKey(expiryDate), '1');
    } catch {
      // Storage unavailable: it stays hidden until the next reload.
    }
  };

  return (
    <Alert
      className="mb-4"
      type="warning"
      showIcon
      closable
      onClose={dismiss}
      message={`Your ${PLAN_NAMES[subscription.planType]} plan expires on ${dayjs(expiryDate).format('D MMM YYYY')} (${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left).`}
      action={
        <Button size="small" type="primary" onClick={() => navigate(ROUTES.billing)}>
          Renew now
        </Button>
      }
    />
  );
}
