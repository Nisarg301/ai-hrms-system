import { PlusOutlined, StopOutlined } from '@ant-design/icons';
import { Alert, Button, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { confirmAction } from '../../components/ConfirmDialog/confirmDialog';
import { DataTable } from '../../components/DataTable/DataTable';
import { SearchInput } from '../../components/SearchInput/SearchInput';
import { StatusTag } from '../../components/StatusTag/StatusTag';
import { TempPasswordModal } from '../../components/TempPasswordModal/TempPasswordModal';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { tokens } from '../../theme/tokens';
import {
  selectAdminUsers,
  selectAdminUsersError,
  selectAdminUsersLoading,
  selectAdminUsersPagination,
  selectAdminUsersTempPassword,
} from '../../store/adminUsers/adminUsersSelectors';
import { pageChanged, searchChanged, tempPasswordCleared } from '../../store/adminUsers/adminUsersSlice';
import { disableAdminUser, fetchAdminUsers } from '../../store/adminUsers/adminUsersThunks';
import type { AdminUserRow } from '../../types/adminUser';
import { InviteOrgAdminModal } from './InviteOrgAdminModal';

export default function AdminUsersPage() {
  const dispatch = useAppDispatch();
  const rows = useAppSelector(selectAdminUsers);
  const loading = useAppSelector(selectAdminUsersLoading);
  const error = useAppSelector(selectAdminUsersError);
  const { page, limit, total } = useAppSelector(selectAdminUsersPagination);

  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebouncedValue(searchText, 300);

  const [inviteOpen, setInviteOpen] = useState(false);
  const tempPassword = useAppSelector(selectAdminUsersTempPassword);

  useEffect(() => {
    dispatch(searchChanged(debouncedSearch));
  }, [debouncedSearch, dispatch]);

  useEffect(() => {
    void dispatch(fetchAdminUsers());
  }, [dispatch, page, limit, debouncedSearch]);

  const onDisable = (row: AdminUserRow) => {
    confirmAction({
      title: `Disable ${row.name}?`,
      content: 'They will no longer be able to sign in. You can re-enable them later from the database.',
      okText: 'Disable',
      onConfirm: async () => {
        await dispatch(disableAdminUser(row.id));
        await dispatch(fetchAdminUsers());
      },
    });
  };

  const columns: ColumnsType<AdminUserRow> = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Email', dataIndex: 'email', key: 'email' },
    {
      title: 'Organization',
      key: 'organizationName',
      render: (_, row) => row.organizationName ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Created',
      key: 'createdAt',
      render: (_, row) => new Date(row.createdAt).toLocaleDateString(),
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, row) => <StatusTag status={row.status} />,
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, row) => (
        <Button danger size="small" disabled={row.status === 'disabled'} icon={<StopOutlined />} onClick={() => onDisable(row)}>
          Disable
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div
        className="mb-4 flex items-center justify-between gap-4 pb-4"
        style={{ borderBottom: `1px solid ${tokens.colorBorder}` }}
      >
        <Typography.Title level={4} className="!mb-0" style={{ color: tokens.colorPrimaryDeep }}>
          Admin Users
        </Typography.Title>
        <div className="flex items-center gap-2">
          <SearchInput value={searchText} onChange={setSearchText} placeholder="Search name or email" />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setInviteOpen(true)}>
            Invite Org Admin
          </Button>
        </div>
      </div>

      {error ? <Alert className="mb-4" type="error" message={error} showIcon /> : null}

      <DataTable<AdminUserRow>
        columns={columns}
        rows={rows}
        loading={loading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={(nextPage, nextLimit) => dispatch(pageChanged({ page: nextPage, limit: nextLimit }))}
        emptyText="No admin users yet"
        emptyHint="Invite your first Org Admin to get started."
      />

      <InviteOrgAdminModal open={inviteOpen} onClose={() => setInviteOpen(false)} />

      <TempPasswordModal
        open={tempPassword !== null}
        password={tempPassword}
        onClose={() => dispatch(tempPasswordCleared())}
      />
    </div>
  );
}
