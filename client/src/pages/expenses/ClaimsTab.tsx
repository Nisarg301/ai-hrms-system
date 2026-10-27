import { DownloadOutlined, WalletOutlined } from '@ant-design/icons';
import { Alert, Button, DatePicker, message, Select, Space, Table, Tag, theme, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExpenseReviewDrawer } from '../../components/ExpenseReviewDrawer/ExpenseReviewDrawer';
import { PersonAvatar } from '../../components/PersonAvatar/PersonAvatar';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { useCan } from '../../hooks/useCan';
import { exportExpensesRequest } from '../../services/endpoints/expenses.endpoints';
import { selectExpensesAdmin } from '../../store/expensesAdmin/expensesAdminSelectors';
import { closeAdminClaim } from '../../store/expensesAdmin/expensesAdminSlice';
import { fetchAdminClaims, fetchAllCategories, fetchExpensePendingCount, openAdminClaim } from '../../store/expensesAdmin/expensesAdminThunks';
import { selectPeople } from '../../store/team/teamSelectors';
import { fetchPeople } from '../../store/team/teamThunks';
import { ApiError } from '../../types/api';
import type { AdminClaimFilters, AdminExpenseClaim, ExpenseClaim } from '../../types/expense';
import { CLAIM_STATUS_META } from '../../utils/expenseFormat';
import { formatInrExact } from '../../utils/formatInr';
import { filenameFromDisposition, saveBlob } from '../../utils/saveBlob';
import { PayClaimsModal } from './PayClaimsModal';

const PAGE_SIZE = 20;
const MAX_PAY = 100;
const STATUSES = ['submitted', 'approved', 'rejected', 'paid'] as const;
const STATUS_OPTIONS = STATUSES.map((s) => ({ value: s, label: CLAIM_STATUS_META[s].label }));
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The filters live in the URL (?status=approved&employee=…&from=…&to=…), so the AI assistant and bookmarks can set them. */
function filtersFrom(params: URLSearchParams): AdminClaimFilters {
  const status = STATUSES.find((s) => s === params.get('status'));
  const day = (key: string) => {
    const v = params.get(key);
    return v && DAY.test(v) ? v : undefined;
  };
  return { status, employeeId: params.get('employee') ?? undefined, categoryId: params.get('category') ?? undefined, from: day('from'), to: day('to') };
}

/** Everyone's claims (not drafts): filters, the review drawer, and paying approved claims in bulk. */
export function ClaimsTab() {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const can = useCan();
  const { claims, claimsTotal, claimsStatus, claimsError, categories } = useAppSelector(selectExpensesAdmin);
  const people = useAppSelector(selectPeople);
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const filters = useMemo(() => filtersFrom(new URLSearchParams(query)), [query]);
  const [page, setPage] = useState(1);
  /** Ticked approved claims, kept across pages so the total stays right. */
  const [selected, setSelected] = useState<Record<string, AdminExpenseClaim>>({});
  const [paying, setPaying] = useState<ExpenseClaim[] | null>(null);
  const [exporting, setExporting] = useState(false);
  // Exports are Professional; can() checks the plan.
  const canExport = can('exports', 'read');

  const load = () => dispatch(fetchAdminClaims({ filters, page, limit: PAGE_SIZE }));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, filters, page]);
  useEffect(() => {
    void dispatch(fetchPeople());
    void dispatch(fetchAllCategories());
    return () => {
      dispatch(closeAdminClaim());
    };
  }, [dispatch]);

  // New filters, by hand or from the assistant, start again on the first page.
  useEffect(() => setPage(1), [query]);

  const setFilter = (next: AdminClaimFilters) => {
    const url = new URLSearchParams();
    const tab = params.get('tab');
    if (tab) url.set('tab', tab);
    const entries: [string, string | undefined][] = [
      ['status', next.status],
      ['employee', next.employeeId],
      ['category', next.categoryId],
      ['from', next.from],
      ['to', next.to],
    ];
    for (const [key, value] of entries) if (value) url.set(key, value);
    setParams(url, { replace: true });
  };

  const refresh = () => {
    void load();
    void dispatch(fetchExpensePendingCount());
  };

  const review = async (id: string) => {
    const result = await dispatch(openAdminClaim(id));
    if (openAdminClaim.rejected.match(result)) void message.error(result.payload ?? 'Could not open the claim');
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const res = await exportExpensesRequest({ from: filters.from, to: filters.to });
      saveBlob(res.data, filenameFromDisposition(res.headers['content-disposition'], 'expenses.csv'));
    } catch (err) {
      void message.error(err instanceof ApiError ? err.message : 'Could not export');
    } finally {
      setExporting(false);
    }
  };

  const chosen = Object.values(selected);
  const chosenTotal = chosen.reduce((sum, c) => sum + c.totalPaise, 0);

  const columns: ColumnsType<AdminExpenseClaim> = [
    {
      title: 'Employee',
      key: 'employee',
      render: (_, c) => (
        <span className="flex items-center gap-2">
          <PersonAvatar name={c.employeeName ?? '?'} avatarUrl={people.find((p) => p.id === c.employeeId)?.avatarUrl} size="small" />
          {c.employeeName ?? 'Former member'}
        </span>
      ),
    },
    {
      title: 'Claim',
      key: 'claim',
      render: (_, c) => (
        <div>
          <div className="font-medium">{c.title}</div>
          <div className="text-xs" style={{ color: token.colorTextSecondary }}>
            {c.number}
          </div>
        </div>
      ),
    },
    { title: 'Submitted', key: 'submitted', render: (_, c) => (c.submittedAt ? dayjs(c.submittedAt).format('DD MMM YYYY') : '—') },
    {
      title: 'Expenses',
      key: 'items',
      render: (_, c) => (
        <span className="flex flex-wrap items-center gap-1">
          {c.itemCount}
          {c.overLimitCount ? <Tag color="orange">{c.overLimitCount} over limit</Tag> : null}
        </span>
      ),
    },
    { title: 'Total', key: 'total', align: 'right', render: (_, c) => <span className="tabular-nums">{formatInrExact(c.totalPaise)}</span> },
    {
      title: 'Status',
      key: 'status',
      render: (_, c) => {
        const tag = <Tag color={CLAIM_STATUS_META[c.status].color}>{CLAIM_STATUS_META[c.status].label}</Tag>;
        return c.status === 'paid' && c.paidOn ? (
          <Tooltip title={`Paid on ${dayjs(c.paidOn).format('D MMM YYYY')} · ref ${c.paymentReference}`}>{tag}</Tooltip>
        ) : (
          tag
        );
      },
    },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Space wrap>
          <Select
            aria-label="Status"
            allowClear
            placeholder="Any status"
            style={{ width: 190 }}
            value={filters.status}
            options={STATUS_OPTIONS}
            onChange={(v) => setFilter({ ...filters, status: v })}
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
            onChange={(v) => setFilter({ ...filters, employeeId: v })}
          />
          <Select
            aria-label="Category"
            allowClear
            placeholder="Any category"
            style={{ width: 180 }}
            value={filters.categoryId}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(v) => setFilter({ ...filters, categoryId: v })}
          />
          <DatePicker.RangePicker
            aria-label="Expense dates"
            format="DD MMM YYYY"
            value={filters.from && filters.to ? [dayjs(filters.from), dayjs(filters.to)] : null}
            onChange={(range) => setFilter({ ...filters, from: range?.[0]?.format('YYYY-MM-DD'), to: range?.[1]?.format('YYYY-MM-DD') })}
          />
        </Space>
        <Space wrap>
          {canExport ? (
            <Tooltip title="One row per expense dated in the chosen range (this month if none)">
              <Button icon={<DownloadOutlined />} loading={exporting} onClick={onExport}>
                Export CSV
              </Button>
            </Tooltip>
          ) : null}
          <Button
            type="primary"
            icon={<WalletOutlined />}
            disabled={chosen.length === 0 || chosen.length > MAX_PAY}
            onClick={() => setPaying(chosen)}
          >
            {chosen.length ? `Mark ${chosen.length} as paid · ${formatInrExact(chosenTotal)}` : 'Mark as paid'}
          </Button>
        </Space>
      </div>
      <div className="mb-2 text-sm" style={{ color: chosen.length > MAX_PAY ? token.colorError : token.colorTextSecondary }}>
        {chosen.length > MAX_PAY ? `At most ${MAX_PAY} claims at a time.` : 'Tick approved claims to mark them as paid. Open a claim to review it.'}
      </div>
      {claimsError ? <Alert className="mb-4" type="error" showIcon message={claimsError} /> : null}
      <Table<AdminExpenseClaim>
        rowKey="id"
        columns={columns}
        dataSource={claims}
        loading={claimsStatus === 'loading'}
        scroll={{ x: 900 }}
        rowSelection={{
          preserveSelectedRowKeys: true,
          selectedRowKeys: Object.keys(selected),
          getCheckboxProps: (c) => ({ disabled: c.status !== 'approved', 'aria-label': `Select ${c.number}` }),
          onChange: (keys, rows) => {
            setSelected((prev) => {
              const next: Record<string, AdminExpenseClaim> = {};
              for (const key of keys) {
                const row = rows.find((r) => r?.id === key) ?? prev[String(key)];
                if (row) next[String(key)] = row;
              }
              return next;
            });
          },
        }}
        onRow={(c) => ({
          onClick: (e) => {
            // The tick column is for choosing claims to pay, not opening them (a disabled box lets clicks through).
            if ((e.target as HTMLElement).closest('.ant-table-selection-column')) return;
            void review(c.id);
          },
          className: 'cursor-pointer',
        })}
        pagination={{ current: page, pageSize: PAGE_SIZE, total: claimsTotal, hideOnSinglePage: true, showSizeChanger: false, onChange: setPage }}
        locale={{ emptyText: <EmptyState title="No claims match" hint="Submitted claims show up here. Try different filters." /> }}
      />
      <ExpenseReviewDrawer onChanged={refresh} onPay={(c) => setPaying([c])} />
      <PayClaimsModal
        claims={paying}
        onClose={() => setPaying(null)}
        onPaid={() => {
          setSelected({});
          dispatch(closeAdminClaim());
          refresh();
        }}
      />
    </>
  );
}
