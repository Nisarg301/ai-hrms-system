import { DownloadOutlined, ToolOutlined } from '@ant-design/icons';
import { Alert, Button, Card, DatePicker, message, Segmented, Select, Space, Table, Tag, Tooltip, Typography, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { AttendanceRequestDrawer } from '../../components/AttendanceRequestDrawer/AttendanceRequestDrawer';
import { PersonAvatar } from '../../components/PersonAvatar/PersonAvatar';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { useCan } from '../../hooks/useCan';
import { exportAttendanceRequest } from '../../services/endpoints/attendance.endpoints';
import { selectAttendanceAdmin } from '../../store/attendanceAdmin/attendanceAdminSelectors';
import { fetchTeamDay, fetchTeamMonth } from '../../store/attendanceAdmin/attendanceAdminThunks';
import { selectAllDepartments } from '../../store/departments/departmentsSelectors';
import { fetchAllDepartments } from '../../store/departments/departmentsThunks';
import { ApiError } from '../../types/api';
import type { DayStatus, DayView, TeamDay, TeamMonthCell } from '../../types/attendance';
import type { Person } from '../../types/people';
import { formatMinutes, formatTime, STATUS_META } from '../../utils/attendanceFormat';
import { filenameFromDisposition, saveBlob } from '../../utils/saveBlob';

type Row = TeamDay['rows'][number];

/** The day's counts worth a glance, in this order. */
const SUMMARY: DayStatus[] = ['present', 'in_progress', 'not_in_yet', 'on_leave', 'half_day', 'absent', 'missing_clock_out'];

export default function TeamAttendancePage() {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const can = useCan();
  const { teamDay, teamMonth, teamStatus, teamError } = useAppSelector(selectAttendanceAdmin);
  const departments = useAppSelector(selectAllDepartments);
  const [mode, setMode] = useState<'day' | 'month'>('day');
  const [date, setDate] = useState(() => dayjs().format('YYYY-MM-DD'));
  const [month, setMonth] = useState(() => dayjs().format('YYYY-MM'));
  const [departmentId, setDepartmentId] = useState<string | undefined>();
  const [recording, setRecording] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Exports are Professional; can() checks the plan.
  const canExport = can('exports', 'read');

  useEffect(() => {
    void dispatch(fetchAllDepartments());
  }, [dispatch]);
  useEffect(() => {
    if (mode === 'day') void dispatch(fetchTeamDay({ date, departmentId }));
    else void dispatch(fetchTeamMonth({ month, departmentId }));
  }, [dispatch, mode, date, month, departmentId]);

  const onExport = async () => {
    setExporting(true);
    try {
      const res = await exportAttendanceRequest(month);
      saveBlob(res.data, filenameFromDisposition(res.headers['content-disposition'], `attendance-${month}.csv`));
    } catch (err) {
      void message.error(err instanceof ApiError ? err.message : 'Could not export');
    } finally {
      setExporting(false);
    }
  };

  const person = (p: Person) => (
    <span className="flex items-center gap-2">
      <PersonAvatar name={p.name} avatarUrl={p.avatarUrl} size="small" />
      <span>
        <div>{p.name}</div>
        <div className="text-xs" style={{ color: token.colorTextSecondary }}>{p.departmentName ?? ''}</div>
      </span>
    </span>
  );

  const statusTag = (d: DayView) => (
    <Space size={4} wrap>
      <Tag color={STATUS_META[d.status].color} className="!mr-0">{STATUS_META[d.status].label}</Tag>
      {d.late ? <Tag color="orange" className="!mr-0">Late</Tag> : null}
      {d.wfh ? <Tag color="blue" className="!mr-0">WFH</Tag> : null}
    </Space>
  );

  const dayColumns: ColumnsType<Row> = [
    { title: 'Employee', key: 'person', render: (_, r) => person(r.person), fixed: 'left', width: 220 },
    { title: 'Status', key: 'status', render: (_, r) => statusTag(r.day) },
    { title: 'First in', key: 'in', render: (_, r) => formatTime(r.day.firstIn) },
    { title: 'Last out', key: 'out', render: (_, r) => formatTime(r.day.lastOut) },
    { title: 'Worked', key: 'worked', render: (_, r) => (r.day.workedMinutes ? formatMinutes(r.day.workedMinutes) : '—') },
    { title: 'Leave', key: 'leave', render: (_, r) => (r.day.leave ? `${r.day.leave.typeName}${r.day.leave.halfDay ? ` (${r.day.leave.halfDay} half)` : ''}` : '—') },
  ];

  const cell = (c: TeamMonthCell) => {
    const meta = STATUS_META[c.status];
    const quiet = c.status === 'weekend' || c.status === 'upcoming' || c.status === 'holiday' || c.status === 'not_joined';
    return (
      <Tooltip title={`${dayjs(c.date).format('ddd D MMM')}: ${meta.label}${c.late ? ', late' : ''}${c.wfh ? ', WFH' : ''}${c.workedMinutes ? ` · ${formatMinutes(c.workedMinutes)}` : ''}`}>
        <span
          data-testid={`cell-${c.date}`}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-xs font-medium"
          style={{
            background: quiet ? token.colorFillQuaternary : undefined,
            outline: c.late ? `1px solid ${token.colorWarning}` : undefined,
            color: c.status === 'absent' || c.status === 'missing_clock_out' ? token.colorError : c.status === 'on_leave' ? token.colorPrimary : undefined,
          }}
        >
          {c.wfh && c.status === 'present' ? 'W' : meta.short}
        </span>
      </Tooltip>
    );
  };

  const monthColumns: ColumnsType<{ person: Person; days: TeamMonthCell[] }> = teamMonth
    ? [
        { title: 'Employee', key: 'person', render: (_, r) => person(r.person), fixed: 'left', width: 200 },
        ...teamMonth.dates.map((d, i) => ({
          title: <span className="text-xs">{dayjs(d).format('D')}<br />{dayjs(d).format('dd')}</span>,
          key: d,
          width: 34,
          align: 'center' as const,
          render: (_: unknown, r: { days: TeamMonthCell[] }) => cell(r.days[i]),
        })),
        {
          title: 'P / A / L',
          key: 'totals',
          fixed: 'right' as const,
          width: 90,
          render: (_: unknown, r: { days: TeamMonthCell[] }) =>
            `${r.days.filter((c) => c.status === 'present').length} / ${r.days.filter((c) => c.status === 'absent').length} / ${r.days.filter((c) => c.status === 'on_leave').length}`,
        },
      ]
    : [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Typography.Title level={4} className="!mb-0">
          Team attendance
        </Typography.Title>
        <Button icon={<ToolOutlined />} onClick={() => setRecording(true)}>
          Fix someone's attendance
        </Button>
      </div>
      <Card>
        <Space wrap className="mb-4">
          <Segmented value={mode} onChange={(v) => setMode(v as 'day' | 'month')} options={[{ label: 'Day', value: 'day' }, { label: 'Month', value: 'month' }]} />
          {mode === 'day' ? (
            <DatePicker
              aria-label="Date"
              allowClear={false}
              format="ddd, DD MMM YYYY"
              value={dayjs(date)}
              disabledDate={(d) => d.isAfter(dayjs(), 'day')}
              onChange={(d) => d && setDate(d.format('YYYY-MM-DD'))}
            />
          ) : (
            <DatePicker
              picker="month"
              aria-label="Month"
              allowClear={false}
              format="MMMM YYYY"
              value={dayjs(`${month}-01`)}
              disabledDate={(d) => d.isAfter(dayjs(), 'month')}
              onChange={(d) => d && setMonth(d.format('YYYY-MM'))}
            />
          )}
          <Select
            aria-label="Department"
            allowClear
            placeholder="All departments"
            style={{ width: 200 }}
            value={departmentId}
            onChange={setDepartmentId}
            options={departments.map((d) => ({ value: d.id, label: d.title }))}
          />
          {mode === 'month' && canExport ? (
            <Button icon={<DownloadOutlined />} loading={exporting} onClick={onExport}>
              Export CSV
            </Button>
          ) : null}
        </Space>

        {teamError ? <Alert className="mb-4" type="error" showIcon message={teamError} /> : null}

        {mode === 'day' ? (
          <>
            {teamDay ? (
              <Space wrap className="mb-4" data-testid="day-summary">
                {SUMMARY.filter((s) => teamDay.counts[s]).map((s) => (
                  <Tag key={s} color={STATUS_META[s].color}>
                    {STATUS_META[s].label}: {teamDay.counts[s]}
                  </Tag>
                ))}
                {teamDay.late ? <Tag color="orange">Late: {teamDay.late}</Tag> : null}
                {teamDay.wfh ? <Tag color="blue">WFH: {teamDay.wfh}</Tag> : null}
              </Space>
            ) : null}
            <Table<Row>
              rowKey={(r) => r.person.id}
              columns={dayColumns}
              dataSource={teamDay?.rows ?? []}
              loading={teamStatus === 'loading'}
              pagination={false}
              scroll={{ x: 800 }}
            />
          </>
        ) : (
          <>
            <div className="mb-3 text-xs" style={{ color: token.colorTextSecondary }}>
              P present · H half day · A absent · L leave · W worked from home · ★ holiday · ! missing clock-out · orange outline = late
            </div>
            <Table
              rowKey={(r) => r.person.id}
              columns={monthColumns}
              dataSource={teamMonth?.rows ?? []}
              loading={teamStatus === 'loading'}
              pagination={false}
              size="small"
              scroll={{ x: 200 + 34 * (teamMonth?.dates.length ?? 31) + 90 }}
            />
          </>
        )}
      </Card>
      <AttendanceRequestDrawer open={recording} mode="record" onClose={() => setRecording(false)} />
    </div>
  );
}
