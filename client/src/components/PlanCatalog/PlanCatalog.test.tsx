import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PLANS } from '../../test/planCatalogData';
import type { BillingCycle } from '../../types/subscription';
import { PlanCatalog } from './PlanCatalog';

function Harness(props: { onChoose?: () => void; currentPlanType?: 'basic' | 'professional' | null }) {
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  return <PlanCatalog plans={PLANS} cycle={cycle} onCycleChange={setCycle} {...props} />;
}

function price(planType: string) {
  return within(screen.getByTestId(`plan-${planType}`));
}

describe('PlanCatalog', () => {
  it('shows INR prices for each billing cycle', async () => {
    render(<Harness />);
    expect(price('basic').getByText('₹300')).toBeInTheDocument();
    expect(price('professional').getByText('₹600')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Quarterly'));
    expect(price('basic').getByText('₹900')).toBeInTheDocument();
    expect(price('professional').getByText('₹1,800')).toBeInTheDocument();
    expect(price('basic').getByText('/ quarter')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Yearly'));
    expect(price('basic').getByText('₹3,600')).toBeInTheDocument();
    expect(price('professional').getByText('₹7,200')).toBeInTheDocument();
  });

  it("lists each plan's modules, with Exports and Audit Logs only on Professional", () => {
    render(<Harness />);
    expect(price('basic').queryByText('Exports')).not.toBeInTheDocument();
    expect(price('basic').queryByText('Audit Logs')).not.toBeInTheDocument();
    expect(price('basic').getByText('Departments')).toBeInTheDocument();
    expect(price('professional').getByText('Exports')).toBeInTheDocument();
    expect(price('professional').getByText('Audit Logs')).toBeInTheDocument();
    expect(price('basic').getByText('Roles & permissions')).toBeInTheDocument();
  });

  it('is read-only without onChoose', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: /choose/i })).not.toBeInTheDocument();
  });

  it('offers a choice per plan and tags the current one', async () => {
    const onChoose = vi.fn();
    render(<Harness onChoose={onChoose} currentPlanType="basic" />);
    expect(price('basic').getByText('Current plan')).toBeInTheDocument();
    expect(price('basic').getByRole('button', { name: 'Renew Basic' })).toBeInTheDocument();

    await userEvent.click(price('professional').getByRole('button', { name: 'Choose Professional' }));
    expect(onChoose).toHaveBeenCalledWith(PLANS[1]);
  });
});
