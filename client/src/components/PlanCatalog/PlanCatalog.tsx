import { CheckOutlined } from '@ant-design/icons';
import { Button, Card, Segmented, Tag, Typography, theme } from 'antd';
import { MODULE_LABELS, PLAN_MODULES } from '../../constants/modules';
import { BILLING_CYCLES, BILLING_CYCLE_LABELS } from '../../constants/plans';
import type { BillingCycle, PlanDefinition, PlanType } from '../../types/subscription';
import { formatInr } from '../../utils/formatInr';

const PER_CYCLE: Record<BillingCycle, string> = { monthly: 'month', quarterly: 'quarter', yearly: 'year' };

interface PlanCatalogProps {
  plans: PlanDefinition[];
  cycle: BillingCycle;
  onCycleChange: (cycle: BillingCycle) => void;
  /** The organization's active plan, tagged "Current plan". */
  currentPlanType?: PlanType | null;
  /** Omit for a read-only catalog (the Super Admin view). */
  onChoose?: (plan: PlanDefinition) => void;
  /** The plan whose payment is in progress. */
  busyPlan?: PlanType | null;
}

/** Plan cards with a billing-cycle switch. Presentational: fetches nothing. */
export function PlanCatalog({ plans, cycle, onCycleChange, currentPlanType, onChoose, busyPlan }: PlanCatalogProps) {
  const { token } = theme.useToken();

  return (
    <div>
      <div className="mb-6 flex justify-center">
        <Segmented<BillingCycle>
          aria-label="Billing cycle"
          value={cycle}
          onChange={onCycleChange}
          options={BILLING_CYCLES.map((value) => ({ value, label: BILLING_CYCLE_LABELS[value] }))}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {plans.map((plan) => {
          const isCurrent = currentPlanType === plan.type;
          // Modules Professional adds on top of Basic, called out on its card.
          const extras = new Set(plan.modules.filter((m) => !PLAN_MODULES.basic.includes(m)));
          return (
            <Card
              key={plan.type}
              data-testid={`plan-${plan.type}`}
              style={isCurrent ? { borderColor: token.colorPrimary, borderWidth: 2 } : undefined}
              styles={{ body: { padding: 28 } }}
            >
              <div className="flex items-start justify-between gap-2">
                <Typography.Title level={3} className="!mb-1">
                  {plan.name}
                </Typography.Title>
                {isCurrent ? <Tag color="blue">Current plan</Tag> : null}
              </div>
              <Typography.Text type="secondary">{plan.description}</Typography.Text>

              <div className="my-6">
                <span className="text-4xl font-bold">{formatInr(plan.prices[cycle])}</span>
                <Typography.Text type="secondary"> / {PER_CYCLE[cycle]}</Typography.Text>
              </div>

              {onChoose ? (
                <Button
                  block
                  size="large"
                  type={plan.type === 'professional' ? 'primary' : 'default'}
                  loading={busyPlan === plan.type}
                  disabled={Boolean(busyPlan) && busyPlan !== plan.type}
                  onClick={() => onChoose(plan)}
                >
                  {isCurrent ? `Renew ${plan.name}` : `Choose ${plan.name}`}
                </Button>
              ) : null}

              <ul className="mt-6 space-y-2" aria-label={`${plan.name} includes`}>
                <li className="flex items-center gap-2">
                  <CheckOutlined style={{ color: token.colorSuccess }} />
                  <span>Roles &amp; permissions</span>
                </li>
                {plan.modules.map((module) => (
                  <li key={module} className="flex items-center gap-2">
                    <CheckOutlined style={{ color: token.colorSuccess }} />
                    <span className={extras.has(module) ? 'font-semibold' : undefined}>{MODULE_LABELS[module]}</span>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
