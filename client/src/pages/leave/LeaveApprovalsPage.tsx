import { CheckOutlined, CloseOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Badge, Button, Card, DatePicker, Select, Space, Table, Tabs, Tooltip, Typography, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApplyLeaveDrawer } from '../../components/ApplyLeaveDrawer/ApplyLeaveDrawer';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { LeaveStatusTag } from '../../components/LeaveStatusTag/LeaveStatusTag';
import { PersonAvatar } from '../../components/PersonAvatar/PersonAvatar';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectAttendancePendingCounts } from '../../store/attendanceAdmin/attendanceAdminSelectors';
import { selectExpensePendingCount } from '../../store/expensesAdmin/expensesAdminSelectors';
import { fetchExpensePendingCount } from '../../store/expensesAdmin/expensesAdminThunks';
import { fetchAttendancePendingCounts } from '../../store/attendanceAdmin/attendanceAdminThunks';
import { selectLeaveAdmin } from '../../store/leaveAdmin/leaveAdminSelectors';
import { setApprovalsView, setLeaveFilters, setLeavePage, type ApprovalsView } from '../../store/leaveAdmin/leaveAdminSlice';
import { fetchLeaveRequests, fetchPendingCount } from '../../store/leaveAdmin/leaveAdminThunks';
import { selectPeople } from '../../store/team/teamSelectors';
import { fetchPeople } from '../../store/team/teamThunks';
import type { AdminLeaveRequestRow, LeaveStatus } from '../../types/leave';
import { formatDays, formatLeaveDates } from '../../utils/leaveFormat';
import { AttendanceRequestsPanel } from './AttendanceRequestsPanel';
import { DecisionModal, type Decision } from './DecisionModal';
import { ExpenseApprovalsPanel } from './ExpenseApprovalsPanel';

const STATUS_OPTIONS: { value: LeaveStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function LeaveApprovalsPage() {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const { view, filters, page, limit, total, items, status, error, pendingCount } = useAppSelector(selectLeaveAdmin);
  const attendanceCounts = useAppSelector(selectAttendancePendingCounts);
  const expensesPending = useAppSelector(selectExpensePendingCount);
  const [params, setParams] = useSearchParams();
  const section = (['leave', 'fixes', 'wfh', 'expenses'] as const).find((k) => k === params.get('tab')) ?? 'leave';
  const people = useAppSelector(selectPeople);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    void dispatch(fetchPendingCount());
    void dispatch(fetchAttendancePendingCounts());
    void dispatch(fetchExpensePendingCount());
    void dispatch(fetchPeople());
  }, [dispatch]);

  useEffect(() => {
    void dispatch(fetchLeaveRequests());
  }, [dispatch, view, filters, page, limit]);

  const employeeCell = (_: unknown, r: AdminLeaveRequestRow) => (
    <span className="flex items-center gap-2">
      <PersonAvatar name={r.employeeName ?? '?'} avatarUrl={people.find((p) => p.id === r.employeeId)?.avatarUrl} size="small" />
      {r.employeeName ?? 'Former member'}
    </span>
  );

  const common: ColumnsType<AdminLeaveRequestRow> = [
    { title: 'Employee', key: 'employee', render: employeeCell },
    { title: 'Type', key: 'type', render: (_, r) => r.leaveTypeName ?? '—' },
    { title: 'Dates', key: 'dates', render: (_, r) => formatLeaveDates(r.startDate, r.endDate, r.halfDay) },
    { title: 'Days', key: 'days', render: (_, r) => formatDays(r.days) },
  ];

  const pendingColumns: ColumnsType<AdminLeaveRequestRow> = [
    ...common,
    { title: 'Reason', dataIndex: 'reason', key: 'reason', ellipsis: true, render: (v: string) => v || '—' },
    {
      title: 'Left after',
      key: 'availableAfter',
      render: (_, r) =>
        r.availableAfter === null ? (
          <span style={{ color: token.colorTextSecondary }}>Unlimited</span>
        ) : (
          <span style={{ color: r.availableAfter < 0 ? token.colorError : undefined, fontWeight: r.availableAfter < 0 ? 600 : undefined }}>
            {formatDays(r.availableAfter)}
          </span>
        ),
    },
    { title: 'Applied', key: 'applied', render: (_, r) => dayjs(r.createdAt).format('DD MMM') },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_, r) => (
        <Space>
          <Button type="primary" size="small" icon={<CheckOutlined />} aria-label={`Approve ${r.employeeName}`} onClick={() => setDecision({ row: r, action: 'approve' })}>
            Approve
          </Button>
          <Button danger size="small" icon={<CloseOutlined />} aria-label={`Reject ${r.employeeName}`} onClick={() => setDecision({ row: r, action: 'reject' })}>
            Reject
          </Button>
        </Space>
      ),
    },
  ];

  const allColumns: ColumnsType<AdminLeaveRequestRow> = [
    ...common,
    {
      title: 'Status',
      key: 'status',
      render: (_, r) => {
        const tag = <LeaveStatusTag status={r.status} />;
        const decided = r.recordedByName ? `Recorded by ${r.recordedByName}` : r.decidedByName ? `By ${r.decidedByName}` : null;
        const detail = [decided, r.decisionNote || null].filter(Boolean).join(': ');
        return detail ? <Tooltip title={detail}>{tag}</Tooltip> : tag;
      },
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_, r) =>
        r.status === 'pending' ? (
          <Space>
            <Button size="small" type="link" onClick={() => setDecision({ row: r, action: 'approve' })}>
              Approve
            </Button>
            <Button size="small" type="link" danger onClick={() => setDecision({ row: r, action: 'reject' })}>
              Reject
            </Button>
          </Space>
        ) : null,
    },
  ];

  const table = (
    <Table<AdminLeaveRequestRow>
      rowKey="id"
      columns={view === 'pending' ? pendingColumns : allColumns}
      dataSource={items}
      loading={status === 'loading'}
      scroll={{ x: 900 }}
      pagination={{
        current: page,
        pageSize: limit,
        total,
        hideOnSinglePage: true,
        onChange: (p, l) => dispatch(setLeavePage({ page: p, limit: l })),
      }}
      locale={{
        emptyText:
          view === 'pending' ? (
            <EmptyState title="All caught up 🎉" hint="There are no leave requests waiting for you." />
          ) : (
            <EmptyState title="No leave requests match" hint="Try different filters." />
          ),
      }}
    />
  );

  const filterBar = (
    <Space wrap className="mb-4">
      <Select
        aria-label="Status"
        allowClear
        placeholder="Any status"
        style={{ width: 150 }}
        value={filters.status}
        options={STATUS_OPTIONS}
        onChange={(v) => dispatch(setLeaveFilters({ ...filters, status: v }))}
      />
      <Select
        aria-label="Employee"
        allowClear
        showSearch
        optionFilterProp="label"
        placeholder="Any employee"
        style={{ width: 200 }}
        value={filters.employeeId}
        options={people.map((p) => ({ value: p.id, label: p.name }))}
        onChange={(v) => dispatch(setLeaveFilters({ ...filters, employeeId: v }))}
      />
      <DatePicker.RangePicker
        aria-label="Dates"
        format="DD MMM YYYY"
        value={filters.from && filters.to ? [dayjs(filters.from), dayjs(filters.to)] : null}
        onChange={(range) =>
          dispatch(
            setLeaveFilters({
              ...filters,
              from: range?.[0]?.format('YYYY-MM-DD'),
              to: range?.[1]?.format('YYYY-MM-DD'),
            })
          )
        }
      />
    </Space>
  );

  const leaveSection = (
    <>
      <div className="mb-4 flex justify-end">
        <Button icon={<PlusOutlined />} onClick={() => setRecording(true)}>
          Record leave
        </Button>
      </div>
      {error ? <Alert className="mb-4" type="error" showIcon message={error} /> : null}
      <Tabs
        activeKey={view}
        onChange={(key) => dispatch(setApprovalsView(key as ApprovalsView))}
        destroyOnHidden
        items={[
          { key: 'pending', label: 'Pending', children: table },
          {
            key: 'all',
            label: 'All requests',
            children: (
              <>
                {filterBar}
                {table}
              </>
            ),
          },
        ]}
      />
    </>
  );

  const label = (text: string, count: number | null | undefined) => (
    <span className="flex items-center gap-2">
      {text}
      {count ? <Badge count={count} size="small" /> : null}
    </span>
  );

  return (
    <div>
      <Typography.Title level={4}>Approvals</Typography.Title>
      <Card>
        <Tabs
          activeKey={section}
          onChange={(key) => setParams(key === 'leave' ? {} : { tab: key }, { replace: true })}
          destroyOnHidden
          items={[
            { key: 'leave', label: label('Leave', pendingCount), children: leaveSection },
            { key: 'fixes', label: label('Attendance fixes', attendanceCounts?.regularization), children: <AttendanceRequestsPanel kind="regularization" /> },
            { key: 'wfh', label: label('Work from home', attendanceCounts?.wfh), children: <AttendanceRequestsPanel kind="wfh" /> },
            { key: 'expenses', label: label('Expenses', expensesPending), children: <ExpenseApprovalsPanel /> },
          ]}
        />
      </Card>
      <DecisionModal decision={decision} onClose={() => setDecision(null)} />
      <ApplyLeaveDrawer mode="record" open={recording} onClose={() => setRecording(false)} />
    </div>
  );
}
