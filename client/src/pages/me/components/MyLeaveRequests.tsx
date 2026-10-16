import { Button, message, Table, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { confirmAction } from '../../../components/ConfirmDialog/confirmDialog';
import { EmptyState } from '../../../components/EmptyState/EmptyState';
import { LeaveStatusTag } from '../../../components/LeaveStatusTag/LeaveStatusTag';
import { useAppDispatch } from '../../../hooks/store';
import { cancelLeave, refreshAfterLeaveChange } from '../../../store/leave/leaveThunks';
import type { LeaveRequestRow } from '../../../types/leave';
import { formatDays, formatLeaveDates } from '../../../utils/leaveFormat';

export function MyLeaveRequests({ rows, loading }: { rows: LeaveRequestRow[]; loading: boolean }) {
  const dispatch = useAppDispatch();

  const onCancel = (row: LeaveRequestRow) =>
    confirmAction({
      title: 'Cancel this leave?',
      content: `${row.leaveTypeName ?? 'Leave'} on ${formatLeaveDates(row.startDate, row.endDate, row.halfDay)} will be cancelled and the days returned to your balance.`,
      okText: 'Cancel leave',
      onConfirm: async () => {
        const result = await dispatch(cancelLeave(row.id));
        if (cancelLeave.rejected.match(result)) {
          void message.error(result.payload ?? 'Could not cancel the leave');
          return;
        }
        void dispatch(refreshAfterLeaveChange());
      },
    });

  const columns: ColumnsType<LeaveRequestRow> = [
    {
      title: 'Type',
      key: 'type',
      render: (_, r) => (
        <>
          {r.leaveTypeName ?? '—'}
          {r.recordedByName ? <div className="text-xs opacity-60">Recorded by {r.recordedByName}</div> : null}
        </>
      ),
    },
    { title: 'Dates', key: 'dates', render: (_, r) => formatLeaveDates(r.startDate, r.endDate, r.halfDay) },
    { title: 'Days', dataIndex: 'days', key: 'days', render: (d: number) => formatDays(d) },
    { title: 'Reason', dataIndex: 'reason', key: 'reason', ellipsis: true, render: (r: string) => r || '—' },
    {
      title: 'Status',
      key: 'status',
      render: (_, r) => {
        const tag = <LeaveStatusTag status={r.status} />;
        const detail = [r.decidedByName ? `By ${r.decidedByName}` : null, r.decisionNote || null].filter(Boolean).join(': ');
        return detail ? <Tooltip title={detail}>{tag}</Tooltip> : tag;
      },
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_, r) =>
        r.canCancel ? (
          <Button size="small" onClick={() => onCancel(r)} aria-label={`Cancel leave on ${formatLeaveDates(r.startDate, r.endDate, r.halfDay)}`}>
            Cancel
          </Button>
        ) : null,
    },
  ];

  return (
    <Table<LeaveRequestRow>
      rowKey="id"
      columns={columns}
      dataSource={rows}
      loading={loading}
      pagination={rows.length > 10 ? { pageSize: 10 } : false}
      scroll={{ x: 640 }}
      locale={{ emptyText: <EmptyState title="No leave this year" hint="Requests you make show up here." /> }}
    />
  );
}
