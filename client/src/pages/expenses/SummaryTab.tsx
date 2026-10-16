import { Alert, Card, Col, DatePicker, Row, Skeleton, Statistic, theme } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { EmptyNote } from '../home/components/HomeCard';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectExpensesAdmin } from '../../store/expensesAdmin/expensesAdminSelectors';
import { fetchExpenseSummary } from '../../store/expensesAdmin/expensesAdminThunks';
import type { SpendRow } from '../../types/expense';
import { formatInrExact } from '../../utils/formatInr';

type Range = { from: string; to: string };

const iso = (d: Dayjs) => d.format('YYYY-MM-DD');

function thisMonth(): Range {
  return { from: iso(dayjs().startOf('month')), to: iso(dayjs()) };
}

/** Horizontal bars, longest first, scaled to the biggest; plain CSS, no chart library. */
function SpendBars({ title, rows, testId }: { title: string; rows: SpendRow[]; testId: string }) {
  const { token } = theme.useToken();
  const max = Math.max(1, ...rows.map((r) => r.totalPaise));
  return (
    <Card title={title} className="h-full" data-testid={testId}>
      {rows.length === 0 ? (
        <EmptyNote>No approved expenses in these dates.</EmptyNote>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {rows.map((r) => (
            <li key={r.name} data-testid="spend-row">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{r.name}</span>
                <span>
                  <strong className="tabular-nums">{formatInrExact(r.totalPaise)}</strong>
                  <span className="ml-1 text-xs" style={{ color: token.colorTextSecondary }}>
                    · {r.count} expense{r.count === 1 ? '' : 's'}
                  </span>
                </span>
              </div>
              <div className="mt-1 h-2 w-full rounded" style={{ background: token.colorFillSecondary }}>
                <div className="h-2 rounded" style={{ width: `${Math.max(2, (r.totalPaise / max) * 100)}%`, background: token.colorPrimary }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Approved and paid spending by expense date, by category and department; plus what's waiting right now. */
export function SummaryTab() {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const { summary, summaryStatus, summaryError } = useAppSelector(selectExpensesAdmin);
  const [range, setRange] = useState<Range>(thisMonth);

  useEffect(() => {
    void dispatch(fetchExpenseSummary(range));
  }, [dispatch, range]);

  const presets: { label: string; value: [Dayjs, Dayjs] }[] = [
    { label: 'This month', value: [dayjs().startOf('month'), dayjs()] },
    { label: 'Last month', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
    { label: 'This year', value: [dayjs().startOf('year'), dayjs()] },
  ];

  const hint = (count: number) => (
    <div className="text-xs" style={{ color: token.colorTextSecondary }}>
      {count} claim{count === 1 ? '' : 's'}, right now
    </div>
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span>Expenses dated</span>
        <DatePicker.RangePicker
          aria-label="Summary dates"
          format="DD MMM YYYY"
          allowClear={false}
          presets={presets}
          value={[dayjs(range.from), dayjs(range.to)]}
          onChange={(v) => {
            if (v?.[0] && v[1]) setRange({ from: iso(v[0]), to: iso(v[1]) });
          }}
        />
      </div>
      {summaryError ? <Alert className="mb-4" type="error" showIcon message={summaryError} /> : null}
      {!summary && summaryStatus !== 'failed' ? (
        <Card>
          <Skeleton active />
        </Card>
      ) : summary ? (
        <>
          <Row gutter={[16, 16]} className="mb-4">
            <Col xs={12} lg={6}>
              <Card size="small" data-testid="stat-approved">
                <Statistic title="Approved" value={formatInrExact(summary.approvedPaise)} />
                <div className="text-xs" style={{ color: token.colorTextSecondary }}>
                  Paid or to be paid, in these dates
                </div>
              </Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card size="small" data-testid="stat-paid">
                <Statistic title="Paid" value={formatInrExact(summary.paidPaise)} />
                <div className="text-xs" style={{ color: token.colorTextSecondary }}>
                  In these dates
                </div>
              </Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card size="small" data-testid="stat-awaiting-approval">
                <Statistic title="Awaiting approval" value={formatInrExact(summary.awaitingApproval.totalPaise)} />
                {hint(summary.awaitingApproval.count)}
              </Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card size="small" data-testid="stat-to-be-paid">
                <Statistic title="To be paid" value={formatInrExact(summary.awaitingPayment.totalPaise)} />
                {hint(summary.awaitingPayment.count)}
              </Card>
            </Col>
          </Row>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <SpendBars title="By category" rows={summary.byCategory} testId="by-category" />
            </Col>
            <Col xs={24} lg={12}>
              <SpendBars title="By department" rows={summary.byDepartment} testId="by-department" />
            </Col>
          </Row>
        </>
      ) : null}
    </>
  );
}
