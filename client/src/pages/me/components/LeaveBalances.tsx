import { Card, Col, Progress, Row, Skeleton, theme } from 'antd';
import type { LeaveBalance } from '../../../types/leave';
import { formatDays } from '../../../utils/leaveFormat';

export function LeaveBalances({ balances, loading }: { balances: LeaveBalance[]; loading: boolean }) {
  const { token } = theme.useToken();
  if (loading) return <Skeleton active paragraph={{ rows: 2 }} />;
  return (
    <Row gutter={[16, 16]} className="mb-4">
      {balances.map((b) => (
        <Col key={b.leaveTypeId} xs={24} sm={12} lg={8} xl={6}>
          <Card data-testid="balance-card">
            <div className="flex items-center justify-between">
              <span className="font-medium">{b.name}</span>
              <span className="text-xs" style={{ color: token.colorTextSecondary }}>
                {b.isPaid ? 'Paid' : 'Unpaid'}
              </span>
            </div>
            <div className="mt-2 text-3xl font-semibold" style={{ color: token.colorPrimary }}>
              {b.available === null ? '∞' : formatDays(b.available)}
            </div>
            <div className="text-sm" style={{ color: token.colorTextSecondary }}>
              {b.available === null ? 'Unlimited' : `of ${formatDays(b.yearlyQuota ?? 0)} days available`}
            </div>
            {b.yearlyQuota ? (
              <Progress percent={Math.round(((b.available ?? 0) / b.yearlyQuota) * 100)} showInfo={false} size="small" strokeColor={token.colorPrimary} />
            ) : null}
            <div className="mt-1 text-xs" style={{ color: token.colorTextSecondary }}>
              {formatDays(b.approved)} taken · {formatDays(b.pending)} pending
            </div>
          </Card>
        </Col>
      ))}
    </Row>
  );
}
