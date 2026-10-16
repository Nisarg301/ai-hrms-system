import { CheckOutlined, CloseOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Input, message, Modal, Segmented, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { AttendanceRequestDrawer } from '../../components/AttendanceRequestDrawer/AttendanceRequestDrawer';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectAttendanceAdmin } from '../../store/attendanceAdmin/attendanceAdminSelectors';
import { decideAttendanceRequest, fetchAttendanceRequests } from '../../store/attendanceAdmin/attendanceAdminThunks';
import type { AttendanceRequestKind, AttendanceRequestRow } from '../../types/attendance';
import { formatLeaveDates } from '../../utils/leaveFormat';

const STATUS_COLORS = { pending: 'gold', approved: 'green', rejected: 'red', cancelled: 'default' } as const;

type Decision = { row: AttendanceRequestRow; action: 'approve' | 'reject' };

function describe(r: AttendanceRequestRow): string {
  return r.kind === 'wfh' ? `work from home on ${formatLeaveDates(r.startDate, r.endDate)}` : `a fix for ${formatLeaveDates(r.startDate, r.endDate)} (${r.clockIn}–${r.clockOut})`;
}

/** One kind of attendance request (fixes or WFH): pending first, or everything. */
export function AttendanceRequestsPanel({ kind }: { kind: AttendanceRequestKind }) {
  const dispatch = useAppDispatch();
  const { requests, requestsStatus, requestsError } = useAppSelector(selectAttendanceAdmin);
  const [view, setView] = useState<'pending' | 'all'>('pending');
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);

  const load = () => dispatch(fetchAttendanceRequests({ kind, status: view === 'pending' ? 'pending' : undefined }));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, kind, view]);

  const onDecide = async () => {
    if (!decision) return;
    setSaving(true);
    const result = await dispatch(decideAttendanceRequest({ id: decision.row.id, action: decision.action, note: note.trim() }));
    setSaving(false);
    if (decideAttendanceRequest.rejected.match(result)) {
      void message.error(result.payload ?? 'Could not save the decision');
    } else {
      void message.success(`${decision.action === 'approve' ? 'Approved' : 'Rejected'} ${decision.row.employeeName ?? 'the'}'s request`);
    }
    setDecision(null);
    void load();
  };

  const columns: ColumnsType<AttendanceRequestRow> = [
    { title: 'Employee', key: 'employee', render: (_, r) => r.employeeName ?? 'Former member' },
    { title: kind === 'wfh' ? 'Dates' : 'Date', key: 'dates', render: (_, r) => formatLeaveDates(r.startDate, r.endDate) },
    ...(kind === 'regularization' ? [{ title: 'Corrected times', key: 'times', render: (_: unknown, r: AttendanceRequestRow) => `${r.clockIn}–${r.clockOut}` }] : []),
    { title: 'Reason', dataIndex: 'reason', key: 'reason', ellipsis: true, render: (v: string) => v || '—' },
    { title: 'Requested', key: 'created', render: (_, r) => dayjs(r.createdAt).format('DD MMM') },
    ...(view === 'all'
      ? [
          {
            title: 'Status',
            key: 'status',
            render: (_: unknown, r: AttendanceRequestRow) => {
              const tag = <Tag color={STATUS_COLORS[r.status]}>{r.status[0].toUpperCase() + r.status.slice(1)}</Tag>;
              const by = r.recordedByName ? `Recorded by ${r.recordedByName}` : r.decidedByName ? `By ${r.decidedByName}` : null;
              const detail = [by, r.decisionNote || null].filter(Boolean).join(': ');
              return detail ? <Tooltip title={detail}>{tag}</Tooltip> : tag;
            },
          },
        ]
      : []),
    {
      title: '',
      key: 'actions',
      align: 'right' as const,
      render: (_: unknown, r: AttendanceRequestRow) =>
        r.status === 'pending' ? (
          <Space>
            <Button size="small" type="primary" icon={<CheckOutlined />} aria-label={`Approve ${r.employeeName}`} onClick={() => { setNote(''); setDecision({ row: r, action: 'approve' }); }}>
              Approve
            </Button>
            <Button size="small" danger icon={<CloseOutlined />} aria-label={`Reject ${r.employeeName}`} onClick={() => { setNote(''); setDecision({ row: r, action: 'reject' }); }}>
              Reject
            </Button>
          </Space>
        ) : null,
    },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Segmented value={view} onChange={(v) => setView(v as 'pending' | 'all')} options={[{ label: 'Pending', value: 'pending' }, { label: 'All', value: 'all' }]} />
        {kind === 'regularization' ? (
          <Button icon={<PlusOutlined />} onClick={() => setRecording(true)}>
            Fix someone's attendance
          </Button>
        ) : null}
      </div>
      {requestsError ? <Alert className="mb-4" type="error" showIcon message={requestsError} /> : null}
      <Table<AttendanceRequestRow>
        rowKey="id"
        columns={columns}
        dataSource={requests}
        loading={requestsStatus === 'loading'}
        pagination={false}
        scroll={{ x: 800 }}
        locale={{
          emptyText:
            view === 'pending' ? (
              <EmptyState title="All caught up 🎉" hint={kind === 'wfh' ? 'No work-from-home requests are waiting.' : 'No attendance fixes are waiting.'} />
            ) : (
              <EmptyState title="No requests yet" />
            ),
        }}
      />
      <Modal
        open={Boolean(decision)}
        title={decision?.action === 'approve' ? 'Approve request?' : 'Reject request?'}
        okText={decision?.action === 'approve' ? 'Approve' : 'Reject'}
        okButtonProps={{ danger: decision?.action === 'reject' }}
        confirmLoading={saving}
        onOk={onDecide}
        onCancel={() => setDecision(null)}
      >
        {decision ? (
          <>
            <p>
              <strong>{decision.row.employeeName ?? 'This employee'}</strong> asked for {describe(decision.row)}.
            </p>
            {decision.row.reason ? <p className="italic opacity-80">“{decision.row.reason}”</p> : null}
            {decision.action === 'approve' && decision.row.kind === 'regularization' ? (
              <Alert className="mb-3" type="info" showIcon message="Approving replaces that day's punches with these times." />
            ) : null}
            <label htmlFor="att-decision-note" className="mb-1 block">
              Note to {decision.row.employeeName ?? 'the employee'} (optional)
            </label>
            <Input.TextArea id="att-decision-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </>
        ) : null}
      </Modal>
      <AttendanceRequestDrawer open={recording} mode="record" onClose={() => setRecording(false)} />
    </>
  );
}
