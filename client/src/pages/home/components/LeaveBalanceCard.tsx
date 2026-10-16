import { CalendarOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Progress, theme } from 'antd';
import type { LeaveBalance } from '../../../types/leave';
import { EmptyNote, HomeCard } from './HomeCard';

function formatDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function LeaveBalanceCard({ balances, onApply }: { balances: LeaveBalance[]; onApply: () => void }) {
  const { token } = theme.useToken();
  return (
    <HomeCard
      title="My leave balance"
      icon={<CalendarOutlined />}
      extra={
        <Button size="small" type="link" icon={<PlusOutlined />} onClick={onApply}>
          Apply
        </Button>
      }
    >
      {balances.length === 0 ? (
        <EmptyNote>No leave types are set up yet.</EmptyNote>
      ) : (
        <div className="flex flex-col gap-3">
          {balances.map((b) => (
            <div key={b.leaveTypeId}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{b.name}</span>
                <span className="text-sm">
                  {b.available === null ? (
                    'Unlimited'
                  ) : (
                    <>
                      <strong>{formatDays(b.available)}</strong> of {formatDays(b.yearlyQuota ?? 0)} left
                    </>
                  )}
                </span>
              </div>
              {b.yearlyQuota ? (
                <Progress
                  percent={Math.round(((b.available ?? 0) / b.yearlyQuota) * 100)}
                  showInfo={false}
                  size="small"
                  strokeColor={token.colorPrimary}
                />
              ) : null}
              <div className="text-xs" style={{ color: token.colorTextSecondary }}>
                {formatDays(b.approved)} taken{b.pending ? ` · ${formatDays(b.pending)} pending` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </HomeCard>
  );
}
