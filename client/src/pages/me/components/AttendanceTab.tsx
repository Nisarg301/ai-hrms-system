import { HomeOutlined, LeftOutlined, RightOutlined, ToolOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Descriptions, Drawer, message, Row, Skeleton, Space, Statistic, Table, Tag, theme, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { AttendanceRequestDrawer, type AttendanceRequestMode } from '../../../components/AttendanceRequestDrawer/AttendanceRequestDrawer';
import { confirmAction } from '../../../components/ConfirmDialog/confirmDialog';
import { EmptyState } from '../../../components/EmptyState/EmptyState';
import { useAppDispatch, useAppSelector } from '../../../hooks/store';
import { selectAttendance } from '../../../store/attendance/attendanceSelectors';
import { cancelAttendanceRequest, fetchMyAttendanceRequests, fetchMyMonth, refreshMyAttendance } from '../../../store/attendance/attendanceThunks';
import type { AttendanceRequestRow, DayView } from '../../../types/attendance';
import { canRequestFix, formatMinutes, formatTime, STATUS_META } from '../../../utils/attendanceFormat';
import { formatLeaveDates } from '../../../utils/leaveFormat';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const REQUEST_STATUS_COLORS = { pending: 'gold', approved: 'green', rejected: 'red', cancelled: 'default' } as const;

function DayCell({ day, isToday, onClick }: { day: DayView; isToday: boolean; onClick: () => void }) {
  const { token } = theme.useToken();
  const meta = STATUS_META[day.status];
  const quiet = day.status === 'weekend' || day.status === 'upcoming' || day.status === 'not_joined';
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`day-${day.date}`}
      aria-label={`${dayjs(day.date).format('D MMMM')}: ${meta.label}${day.late ? ', late' : ''}${day.wfh ? ', WFH' : ''}`}
      className="flex h-24 w-full cursor-pointer flex-col items-start gap-1 rounded-lg border p-2 text-left"
      style={{
        background: quiet ? token.colorFillQuaternary : token.colorBgContainer,
        borderColor: isToday ? token.colorPrimary : token.colorBorderSecondary,
        borderWidth: isToday ? 2 : 1,
      }}
    >
      <div className="flex w-full items-center justify-between">
        <span className="text-sm font-medium">{dayjs(day.date).date()}</span>
        <span className="flex gap-1">
          {day.late ? <Tooltip title="Late"><span className="text-xs" style={{ color: token.colorWarning }}>L</span></Tooltip> : null}
          {day.wfh ? <Tooltip title="Work from home"><HomeOutlined style={{ color: token.colorInfo, fontSize: 12 }} /></Tooltip> : null}
        </span>
      </div>
      {day.status !== 'upcoming' && day.status !== 'not_joined' ? (
        <Tag color={meta.color} className="!mr-0 max-w-full truncate text-[11px]">
          {day.holidayName ?? (day.status === 'on_leave' && day.leave ? day.leave.typeName : meta.label)}
        </Tag>
      ) : null}
      {day.workedMinutes > 0 ? <span className="text-xs" style={{ color: token.colorTextSecondary }}>{formatMinutes(day.workedMinutes)}</span> : null}
    </button>
  );
}

export function AttendanceTab() {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const { month, monthStatus, monthError, requests } = useAppSelector(selectAttendance);
  const [shown, setShown] = useState(() => dayjs().format('YYYY-MM'));
  const [openDay, setOpenDay] = useState<DayView | null>(null);
  const [drawer, setDrawer] = useState<{ mode: AttendanceRequestMode; date: string | null } | null>(null);
  const today = dayjs().format('YYYY-MM-DD');

  useEffect(() => {
    void dispatch(fetchMyMonth(shown));
  }, [dispatch, shown]);
  useEffect(() => {
    void dispatch(fetchMyAttendanceRequests());
  }, [dispatch]);

  const onCancel = (r: AttendanceRequestRow) =>
    confirmAction({
      title: 'Cancel this request?',
      content: r.kind === 'wfh' ? `Work from home on ${formatLeaveDates(r.startDate, r.endDate)}.` : `The fix for ${formatLeaveDates(r.startDate, r.endDate)}.`,
      okText: 'Cancel request',
      onConfirm: async () => {
        const result = await dispatch(cancelAttendanceRequest(r.id));
        if (cancelAttendanceRequest.rejected.match(result)) {
          void message.error(result.payload ?? 'Could not cancel');
          return;
        }
        void dispatch(refreshMyAttendance());
      },
    });

  // Pad the first week so days line up under Mon..Sun.
  const leading = month ? (dayjs(month.days[0].date).day() + 6) % 7 : 0;

  const requestColumns: ColumnsType<AttendanceRequestRow> = [
    { title: 'Request', key: 'kind', render: (_, r) => (r.kind === 'wfh' ? 'Work from home' : 'Attendance fix') },
    {
      title: 'Dates',
      key: 'dates',
      render: (_, r) => (
        <>
          {formatLeaveDates(r.startDate, r.endDate)}
          {r.kind === 'regularization' ? <span className="opacity-60"> · {r.clockIn}–{r.clockOut}</span> : null}
          {r.recordedByName ? <div className="text-xs opacity-60">Recorded by {r.recordedByName}</div> : null}
        </>
      ),
    },
    { title: 'Reason', dataIndex: 'reason', key: 'reason', ellipsis: true, render: (v: string) => v || '—' },
    {
      title: 'Status',
      key: 'status',
      render: (_, r) => {
        const tag = <Tag color={REQUEST_STATUS_COLORS[r.status]}>{r.status[0].toUpperCase() + r.status.slice(1)}</Tag>;
        const detail = [r.decidedByName ? `By ${r.decidedByName}` : null, r.decisionNote || null].filter(Boolean).join(': ');
        return detail ? <Tooltip title={detail}>{tag}</Tooltip> : tag;
      },
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_, r) => (r.canCancel ? <Button size="small" onClick={() => onCancel(r)}>Cancel</Button> : null),
    },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Space>
          <Button icon={<LeftOutlined />} aria-label="Previous month" onClick={() => setShown(dayjs(`${shown}-01`).subtract(1, 'month').format('YYYY-MM'))} />
          <span className="min-w-[130px] text-center text-base font-semibold" data-testid="shown-month">
            {dayjs(`${shown}-01`).format('MMMM YYYY')}
          </span>
          <Button
            icon={<RightOutlined />}
            aria-label="Next month"
            disabled={shown >= dayjs().format('YYYY-MM')}
            onClick={() => setShown(dayjs(`${shown}-01`).add(1, 'month').format('YYYY-MM'))}
          />
        </Space>
        <Space wrap>
          <Button icon={<ToolOutlined />} onClick={() => setDrawer({ mode: 'fix', date: null })}>
            Request a fix
          </Button>
          <Button type="primary" icon={<HomeOutlined />} onClick={() => setDrawer({ mode: 'wfh', date: null })}>
            Request WFH
          </Button>
        </Space>
      </div>

      {monthError ? <Alert className="mb-4" type="error" showIcon message={monthError} /> : null}
      {month ? (
        <Row gutter={[16, 16]} className="mb-4">
          {[
            ['Present', month.totals.present],
            ['Half days', month.totals.halfDay],
            ['Absent', month.totals.absent],
            ['Late', month.totals.late],
            ['Leave days', month.totals.onLeave],
          ].map(([title, value]) => (
            <Col key={title} xs={12} sm={8} md={4}>
              <Card size="small">
                <Statistic title={title} value={value} />
              </Card>
            </Col>
          ))}
          <Col xs={12} sm={8} md={4}>
            <Card size="small">
              <Statistic title="Average day" value={formatMinutes(month.totals.averageMinutes)} />
            </Card>
          </Col>
        </Row>
      ) : null}

      <Card className="mb-4">
        {!month || monthStatus === 'loading' ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : (
          <div className="overflow-x-auto">
            <div className="grid min-w-[640px] grid-cols-7 gap-2" data-testid="month-grid">
              {WEEKDAYS.map((d) => (
                <div key={d} className="text-center text-xs font-medium uppercase" style={{ color: token.colorTextSecondary }}>
                  {d}
                </div>
              ))}
              {Array.from({ length: leading }, (_, i) => (
                <div key={`pad-${i}`} />
              ))}
              {month.days.map((d) => (
                <DayCell key={d.date} day={d} isToday={d.date === today} onClick={() => setOpenDay(d)} />
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card title="My requests">
        <Table<AttendanceRequestRow>
          rowKey="id"
          columns={requestColumns}
          dataSource={requests}
          pagination={requests.length > 10 ? { pageSize: 10 } : false}
          scroll={{ x: 640 }}
          locale={{ emptyText: <EmptyState title="No requests yet" hint="Fixes and work-from-home requests show up here." /> }}
        />
      </Card>

      <Drawer open={Boolean(openDay)} onClose={() => setOpenDay(null)} title={openDay ? dayjs(openDay.date).format('dddd, D MMMM YYYY') : ''} width={380}>
        {openDay ? (
          <>
            <Space className="mb-4" wrap>
              <Tag color={STATUS_META[openDay.status].color}>{STATUS_META[openDay.status].label}</Tag>
              {openDay.late ? <Tag color="orange">Late</Tag> : null}
              {openDay.wfh ? <Tag color="blue">Work from home</Tag> : null}
            </Space>
            <Descriptions column={1} size="small" colon={false}>
              <Descriptions.Item label="First in">{formatTime(openDay.firstIn)}</Descriptions.Item>
              <Descriptions.Item label="Last out">{formatTime(openDay.lastOut)}</Descriptions.Item>
              <Descriptions.Item label="Worked">{formatMinutes(openDay.workedMinutes)}</Descriptions.Item>
              {openDay.leave ? (
                <Descriptions.Item label="Leave">
                  {openDay.leave.typeName}
                  {openDay.leave.halfDay ? ` (${openDay.leave.halfDay} half)` : ''}
                </Descriptions.Item>
              ) : null}
              {openDay.holidayName ? <Descriptions.Item label="Holiday">{openDay.holidayName}</Descriptions.Item> : null}
            </Descriptions>
            {openDay.missingClockOut ? (
              <Alert className="my-3" type="warning" showIcon message="You didn't clock out this day, so it counts no hours until it's fixed." />
            ) : null}
            {canRequestFix(openDay, today) ? (
              <Button
                block
                className="mt-4"
                icon={<ToolOutlined />}
                onClick={() => {
                  setDrawer({ mode: 'fix', date: openDay.date });
                  setOpenDay(null);
                }}
              >
                Request a fix for this day
              </Button>
            ) : null}
          </>
        ) : null}
      </Drawer>

      <AttendanceRequestDrawer open={Boolean(drawer)} mode={drawer?.mode ?? 'fix'} initialDate={drawer?.date ?? null} onClose={() => setDrawer(null)} />
    </>
  );
}
