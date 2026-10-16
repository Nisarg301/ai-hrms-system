import { ArrowRightOutlined } from '@ant-design/icons';
import { Alert, Button, message, Table, Tag, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { ExpenseReviewDrawer } from '../../components/ExpenseReviewDrawer/ExpenseReviewDrawer';
import { PersonAvatar } from '../../components/PersonAvatar/PersonAvatar';
import { ROUTES } from '../../constants/routes';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectExpensesAdmin } from '../../store/expensesAdmin/expensesAdminSelectors';
import { closeAdminClaim } from '../../store/expensesAdmin/expensesAdminSlice';
import { fetchAdminClaims, fetchExpensePendingCount, openAdminClaim } from '../../store/expensesAdmin/expensesAdminThunks';
import { selectPeople } from '../../store/team/teamSelectors';
import type { AdminExpenseClaim } from '../../types/expense';
import { formatInrExact } from '../../utils/formatInr';

const PAGE_SIZE = 20;

/** Claims waiting for approval, oldest first; Review opens the claim to approve or reject. */
export function ExpenseApprovalsPanel() {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const { claims, claimsTotal, claimsStatus, claimsError } = useAppSelector(selectExpensesAdmin);
  const people = useAppSelector(selectPeople);
  const [page, setPage] = useState(1);

  const load = () => dispatch(fetchAdminClaims({ filters: { status: 'submitted' }, page, limit: PAGE_SIZE }));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, page]);
  useEffect(
    () => () => {
      dispatch(closeAdminClaim());
    },
    [dispatch]
  );

  const review = async (id: string) => {
    const result = await dispatch(openAdminClaim(id));
    if (openAdminClaim.rejected.match(result)) void message.error(result.payload ?? 'Could not open the claim');
  };

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
    { title: 'Submitted', key: 'submitted', render: (_, c) => (c.submittedAt ? dayjs(c.submittedAt).format('DD MMM') : '—') },
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
      title: '',
      key: 'actions',
      align: 'right',
      render: (_, c) => (
        <Button
          size="small"
          type="primary"
          aria-label={`Review ${c.number}`}
          onClick={(e) => {
            e.stopPropagation();
            void review(c.id);
          }}
        >
          Review
        </Button>
      ),
    },
  ];

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Link to={ROUTES.expenses}>
          All claims <ArrowRightOutlined />
        </Link>
      </div>
      {claimsError ? <Alert className="mb-4" type="error" showIcon message={claimsError} /> : null}
      <Table<AdminExpenseClaim>
        rowKey="id"
        columns={columns}
        dataSource={claims}
        loading={claimsStatus === 'loading'}
        scroll={{ x: 800 }}
        onRow={(c) => ({ onClick: () => void review(c.id), className: 'cursor-pointer' })}
        pagination={{ current: page, pageSize: PAGE_SIZE, total: claimsTotal, hideOnSinglePage: true, onChange: setPage }}
        locale={{ emptyText: <EmptyState title="All caught up 🎉" hint="No expense claims are waiting for you." /> }}
      />
      <ExpenseReviewDrawer
        onChanged={() => {
          void load();
          void dispatch(fetchExpensePendingCount());
        }}
      />
    </>
  );
}
