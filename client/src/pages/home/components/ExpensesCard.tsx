import { WalletOutlined } from '@ant-design/icons';
import { Button, theme } from 'antd';
import type { ClaimsSummary } from '../../../utils/expenseFormat';
import { formatInrExact } from '../../../utils/formatInr';
import { HomeCard } from './HomeCard';

/** My claims in flight; the dashboard shows it only when something is awaiting approval or payment. */
export function ExpensesCard({ summary, onView }: { summary: ClaimsSummary; onView: () => void }) {
  const { token } = theme.useToken();
  const rows = [
    { label: 'Awaiting approval', ...summary.awaiting },
    { label: 'To be paid', ...summary.toBePaid },
  ].filter((r) => r.count > 0);
  return (
    <HomeCard
      title="My expenses"
      icon={<WalletOutlined />}
      extra={
        <Button size="small" type="link" onClick={onView}>
          View
        </Button>
      }
    >
      <div className="flex flex-col gap-2" data-testid="expenses-card">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-2">
            <span>
              {r.label}
              <span className="ml-1 text-xs" style={{ color: token.colorTextSecondary }}>
                ({r.count} claim{r.count === 1 ? '' : 's'})
              </span>
            </span>
            <strong className="tabular-nums">{formatInrExact(r.totalPaise)}</strong>
          </div>
        ))}
      </div>
    </HomeCard>
  );
}
