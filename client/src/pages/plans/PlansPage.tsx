import { Alert, Skeleton, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { PlanCatalog } from '../../components/PlanCatalog/PlanCatalog';
import { listPlansRequest } from '../../services/endpoints/subscription.endpoints';
import { ApiError } from '../../types/api';
import type { BillingCycle, PlanDefinition } from '../../types/subscription';

/** Super Admin's read-only view of the plans organizations can buy, straight from the backend catalog. */
export default function PlansPage() {
  const [plans, setPlans] = useState<PlanDefinition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>('monthly');

  useEffect(() => {
    listPlansRequest()
      .then(({ data }) => setPlans(data))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load plans'));
  }, []);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <Typography.Title level={4} className="!mb-1">
          Plans
        </Typography.Title>
        <Typography.Text type="secondary">
          What organizations can subscribe to. Prices are in INR; organization admins pay through Razorpay.
        </Typography.Text>
      </div>
      {error ? (
        <Alert type="error" message={error} showIcon />
      ) : plans ? (
        <PlanCatalog plans={plans} cycle={cycle} onCycleChange={setCycle} />
      ) : (
        <Skeleton active paragraph={{ rows: 8 }} />
      )}
    </div>
  );
}
