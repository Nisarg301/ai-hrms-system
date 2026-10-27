import { Alert, DatePicker, Select, Tag, Typography, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { AUDIT_ACTIONS, type AuditAction, type AuditLogFilters, type AuditLogRow, type AuditModule } from '../../types/auditLog';

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

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The filters live in the URL (?module=leave&action=create&from=2026-10-01&to=2026-10-21), so the
 * AI assistant and bookmarks can set them. The days become whole days here, as the date picker sends them.
 */
function filtersFrom(params: URLSearchParams): AuditLogFilters {
  const module = AUDITED_MODULES.find((m) => m === params.get('module'));
  const action = AUDIT_ACTIONS.find((a) => a === params.get('action'));
  const from = params.get('from');
  const to = params.get('to');
  return {
    module,
    action,
    from: from && DAY.test(from) ? dayjs(from).startOf('day').toISOString() : undefined,
    to: to && DAY.test(to) ? dayjs(to).endOf('day').toISOString() : undefined,
  };
}

const sameFilters = (a: AuditLogFilters, b: AuditLogFilters) => a.module === b.module && a.action === b.action && a.from === b.from && a.to === b.to;

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
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const wanted = useMemo(() => filtersFrom(new URLSearchParams(query)), [query]);
  const synced = sameFilters(wanted, filters);

  // The URL is the source: a new address (by hand, a bookmark, or the assistant) sets the store's filters.
  useEffect(() => {
    if (!synced) dispatch(filtersChanged(wanted));
  }, [dispatch, synced, wanted]);

  useEffect(() => {
    if (synced) void dispatch(fetchAuditLogs());
  }, [dispatch, page, limit, filters, synced]);

  /** A filter changed on the page: written to the URL, which then sets the store. */
  const setFilter = (next: { module?: AuditModule; action?: AuditAction; from?: string; to?: string }) => {
    const url = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) url.set(key, value);
      else url.delete(key);
    }
    setParams(url, { replace: true });
  };

  const onRangeChange = (range: [Dayjs | null, Dayjs | null] | null) => {
    const [start, end] = range ?? [null, null];
    setFilter({ from: start ? start.format('YYYY-MM-DD') : undefined, to: end ? end.format('YYYY-MM-DD') : undefined });
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
            onChange={(module) => setFilter({ module })}
            options={AUDITED_MODULES.map((m) => ({ value: m, label: moduleLabel(m) }))}
          />
          <Select<AuditAction>
            aria-label="Filter by action"
            allowClear
            placeholder="All actions"
            style={{ minWidth: 140 }}
            value={filters.action}
            onChange={(action) => setFilter({ action })}
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
