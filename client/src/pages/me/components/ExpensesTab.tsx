import { PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Form, Input, message, Modal, Row, Statistic, Table, Tag, theme, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EmptyState } from '../../../components/EmptyState/EmptyState';
import { ExpenseClaimDrawer } from '../../../components/ExpenseClaimDrawer/ExpenseClaimDrawer';
import { useAppDispatch, useAppSelector } from '../../../hooks/store';
import { selectExpenses } from '../../../store/expenses/expensesSelectors';
import { closeClaim } from '../../../store/expenses/expensesSlice';
import { createClaim, fetchMyClaims, openClaim } from '../../../store/expenses/expensesThunks';
import type { ExpenseClaim } from '../../../types/expense';
import { CLAIM_STATUS_META, summarizeClaims } from '../../../utils/expenseFormat';
import { formatInrExact } from '../../../utils/formatInr';

function NewClaimModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const [form] = Form.useForm<{ title: string }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async ({ title }: { title: string }) => {
    setSaving(true);
    setError(null);
    const result = await dispatch(createClaim(title.trim()));
    setSaving(false);
    if (createClaim.rejected.match(result)) {
      setError(result.payload?.message ?? 'Could not create the claim');
      return;
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      title="New expense claim"
      okText="Create"
      onOk={() => form.submit()}
      confirmLoading={saving}
      onCancel={onClose}
      destroyOnHidden
      afterOpenChange={(visible) => {
        if (!visible) {
          form.resetFields();
          setError(null);
        }
      }}
    >
      {error ? <Alert className="mb-3" type="error" showIcon message={error} /> : null}
      <Form form={form} name="newClaim" layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item
          name="title"
          label="What is it for?"
          extra="For example: Client visit to Pune, or September internet bill."
          rules={[
            { required: true, whitespace: true, message: 'Give the claim a title' },
            { max: 120, message: 'At most 120 characters' },
          ]}
        >
          <Input autoFocus maxLength={120} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** My expense claims: a summary, the list, and the claim drawer. /me/expenses?new=1 starts a claim. */
export function ExpensesTab() {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const { claims, claimsStatus, claimsError } = useAppSelector(selectExpenses);
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(params.get('new') === '1');
  const summary = summarizeClaims(claims, dayjs().format('YYYY'));

  useEffect(() => {
    void dispatch(fetchMyClaims());
    return () => {
      dispatch(closeClaim());
    };
  }, [dispatch]);

  useEffect(() => {
    if (params.get('new') !== '1') return;
    setCreating(true);
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const open = async (id: string) => {
    const result = await dispatch(openClaim(id));
    if (openClaim.rejected.match(result)) void message.error(result.payload?.message ?? 'Could not open the claim');
  };

  const columns: ColumnsType<ExpenseClaim> = [
    {
      title: 'Claim',
      key: 'claim',
      render: (_, c) => (
        <div>
          <Typography.Link
            className="font-medium"
            onClick={(e) => {
              e.stopPropagation();
              void open(c.id);
            }}
          >
            {c.title}
          </Typography.Link>
          <div className="text-xs" style={{ color: token.colorTextSecondary }}>
            {c.number ?? 'Not submitted yet'}
          </div>
        </div>
      ),
    },
    {
      title: 'Date',
      key: 'date',
      render: (_, c) => dayjs(c.submittedAt ?? c.createdAt).format('D MMM YYYY'),
      responsive: ['sm'],
    },
    { title: 'Expenses', dataIndex: 'itemCount', key: 'itemCount', align: 'right', responsive: ['md'] },
    {
      title: 'Total',
      dataIndex: 'totalPaise',
      key: 'total',
      align: 'right',
      render: (paise: number) => <span className="tabular-nums">{formatInrExact(paise)}</span>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: ExpenseClaim['status']) => <Tag color={CLAIM_STATUS_META[status].color}>{CLAIM_STATUS_META[status].label}</Tag>,
    },
  ];

  const chips: { title: string; value: string; hint?: string }[] = [
    { title: 'Drafts', value: String(summary.drafts) },
    { title: 'Awaiting approval', value: formatInrExact(summary.awaiting.totalPaise), hint: `${summary.awaiting.count} claim${summary.awaiting.count === 1 ? '' : 's'}` },
    { title: 'To be paid', value: formatInrExact(summary.toBePaid.totalPaise), hint: `${summary.toBePaid.count} claim${summary.toBePaid.count === 1 ? '' : 's'}` },
    { title: `Paid in ${dayjs().format('YYYY')}`, value: formatInrExact(summary.paidThisYearPaise) },
  ];

  return (
    <>
      <Row gutter={[16, 16]} className="mb-4">
        {chips.map((chip) => (
          <Col key={chip.title} xs={12} md={6}>
            <Card size="small" data-testid={`chip-${chip.title}`}>
              <Statistic title={chip.title} value={chip.value} />
              {chip.hint ? <div className="text-xs" style={{ color: token.colorTextSecondary }}>{chip.hint}</div> : null}
            </Card>
          </Col>
        ))}
      </Row>

      <Card
        title="My claims"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            New claim
          </Button>
        }
      >
        {claimsError ? (
          <Alert
            className="mb-3"
            type="error"
            showIcon
            message={claimsError}
            action={
              <Button size="small" onClick={() => dispatch(fetchMyClaims())}>
                Retry
              </Button>
            }
          />
        ) : null}
        <Table<ExpenseClaim>
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={claims}
          loading={claimsStatus === 'loading'}
          pagination={claims.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
          onRow={(c) => ({ onClick: () => void open(c.id), className: 'cursor-pointer' })}
          locale={{ emptyText: <EmptyState title="No claims yet" hint="Spent your own money on work? Start a claim and add your receipts." /> }}
        />
      </Card>

      <NewClaimModal open={creating} onClose={() => setCreating(false)} />
      <ExpenseClaimDrawer />
    </>
  );
}
