import { Alert, DatePicker, Select, Tag, Typography, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect } from 'react';
import { DataTable } from '../../components/DataTable/DataTable';
import { MODULE_LABELS } from '../../constants/modules';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import {
  selectAuditLogFilters,
  selectAuditLogs,
  selectAuditLogsError,
  selectAuditLogsLoading,
  selectAuditLogsPagination,
} from '../../store/auditLogs/auditLogsSelectors';
import { filtersChanged, pageChanged } from '../../store/auditLogs/auditLogsSlice';
import { fetchAuditLogs } from '../../store/auditLogs/auditLogsThunks';
import { AUDIT_ACTIONS, type AuditAction, type AuditLogRow, type AuditModule } from '../../types/auditLog';

// Areas audited beyond the permission-matrix modules.
const OTHER_MODULE_LABELS: Record<'roles' | 'holidays' | 'announcements' | 'leave' | 'posts' | 'attendance' | 'expenses' | 'onboarding' | 'performance', string> = {
  roles: 'Roles',
  holidays: 'Holidays',
  announcements: 'Announcements',
  leave: 'Leave',
  posts: 'Posts',
  attendance: 'Attendance',
  expenses: 'Expenses',
  onboarding: 'Onboarding & offboarding',
  performance: 'Performance',
};

// The modules that record create/update/delete.
const AUDITED_MODULES: AuditModule[] = ['employees', 'documents', 'departments', 'projects', 'tasks', 'roles', 'leave', 'holidays', 'announcements', 'posts', 'attendance', 'expenses', 'onboarding', 'performance'];

function moduleLabel(module: AuditModule | null): string {
  if (module === null) return 'Sign-in';
  return module in OTHER_MODULE_LABELS ? OTHER_MODULE_LABELS[module as keyof typeof OTHER_MODULE_LABELS] : MODULE_LABELS[module as keyof typeof MODULE_LABELS];
}

const ACTION_COLORS: Record<AuditAction, string> = {
  create: 'green',
  update: 'blue',
  delete: 'red',
  login: 'default',
  logout: 'default',
};

const ACTION_LABELS: Record<AuditAction, string> = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  login: 'Signed in',
  logout: 'Signed out',
};

const ROLE_LABELS: Record<AuditLogRow['actorRole'], string> = {
  SUPER_ADMIN: 'Super Admin',
  ORG_ADMIN: 'Org Admin',
  ORG_USER: 'User',
};

/** Professional plan: a read-only history of changes and sign-ins in the organization. */
export default function AuditLogsPage() {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const rows = useAppSelector(selectAuditLogs);
  const loading = useAppSelector(selectAuditLogsLoading);
  const error = useAppSelector(selectAuditLogsError);
  const filters = useAppSelector(selectAuditLogFilters);
  const { page, limit, total } = useAppSelector(selectAuditLogsPagination);

  useEffect(() => {
    void dispatch(fetchAuditLogs());
  }, [dispatch, page, limit, filters]);

  const onRangeChange = (range: [Dayjs | null, Dayjs | null] | null) => {
    const [start, end] = range ?? [null, null];
    dispatch(
      filtersChanged({
        ...filters,
        from: start ? start.startOf('day').toISOString() : undefined,
        to: end ? end.endOf('day').toISOString() : undefined,
      })
    );
  };

  const columns: ColumnsType<AuditLogRow> = [
    {
      title: 'When',
      key: 'createdAt',
      render: (_, row) => dayjs(row.createdAt).format('D MMM YYYY, HH:mm'),
    },
    {
      title: 'User',
      key: 'actor',
      render: (_, row) => (
        <div>
          <div>{row.actorName}</div>
          <Typography.Text type="secondary" className="text-xs">
            {ROLE_LABELS[row.actorRole]}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: 'Action',
      key: 'action',
      render: (_, row) => <Tag color={ACTION_COLORS[row.action]}>{ACTION_LABELS[row.action]}</Tag>,
    },
    { title: 'Module', key: 'module', render: (_, row) => moduleLabel(row.module) },
    { title: 'Record', key: 'record', render: (_, row) => row.recordLabel ?? '—' },
    { title: 'IP address', key: 'ip', render: (_, row) => row.ipAddress ?? '—' },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4 pb-4" style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        <div>
          <Typography.Title level={4} className="!mb-1">
            Audit Logs
          </Typography.Title>
          <Typography.Text type="secondary">Every change and sign-in in your organization. Read-only.</Typography.Text>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select<AuditModule>
            aria-label="Filter by module"
            allowClear
            placeholder="All modules"
            style={{ minWidth: 160 }}
            value={filters.module}
            onChange={(module) => dispatch(filtersChanged({ ...filters, module }))}
            options={AUDITED_MODULES.map((m) => ({ value: m, label: moduleLabel(m) }))}
          />
          <Select<AuditAction>
            aria-label="Filter by action"
            allowClear
            placeholder="All actions"
            style={{ minWidth: 140 }}
            value={filters.action}
            onChange={(action) => dispatch(filtersChanged({ ...filters, action }))}
            options={AUDIT_ACTIONS.map((a) => ({ value: a, label: ACTION_LABELS[a] }))}
          />
          <DatePicker.RangePicker
            aria-label="Filter by date"
            value={[filters.from ? dayjs(filters.from) : null, filters.to ? dayjs(filters.to) : null]}
            onChange={(range) => onRangeChange(range as [Dayjs | null, Dayjs | null] | null)}
          />
        </div>
      </div>

      {error ? <Alert className="mb-4" type="error" message={error} showIcon /> : null}

      <DataTable<AuditLogRow>
        columns={columns}
        rows={rows}
        loading={loading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={(nextPage, nextLimit) => dispatch(pageChanged({ page: nextPage, limit: nextLimit }))}
        emptyText="No activity yet"
        emptyHint="Changes and sign-ins will appear here."
      />
    </div>
  );
}
