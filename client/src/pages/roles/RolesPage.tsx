import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Space, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { confirmAction } from '../../components/ConfirmDialog/confirmDialog';
import { DataTable } from '../../components/DataTable/DataTable';
import { SearchInput } from '../../components/SearchInput/SearchInput';
import { MODULE_LABELS } from '../../constants/modules';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { tokens } from '../../theme/tokens';
import {
  selectRoles,
  selectRolesError,
  selectRolesLoading,
  selectRolesPagination,
} from '../../store/roles/rolesSelectors';
import { pageChanged, searchChanged } from '../../store/roles/rolesSlice';
import { deleteRole, fetchRoles } from '../../store/roles/rolesThunks';
import type { Role } from '../../types/role';
import { RoleFormModal } from './RoleFormModal';

export default function RolesPage() {
  const dispatch = useAppDispatch();
  const rows = useAppSelector(selectRoles);
  const loading = useAppSelector(selectRolesLoading);
  const error = useAppSelector(selectRolesError);
  const { page, limit, total } = useAppSelector(selectRolesPagination);

  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebouncedValue(searchText, 300);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);

  useEffect(() => {
    dispatch(searchChanged(debouncedSearch));
  }, [debouncedSearch, dispatch]);

  useEffect(() => {
    void dispatch(fetchRoles());
  }, [dispatch, page, limit, debouncedSearch]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (role: Role) => {
    setEditing(role);
    setFormOpen(true);
  };

  const onDelete = (role: Role) => {
    confirmAction({
      title: `Delete role "${role.name}"?`,
      content: 'Users currently assigned this role will keep the assignment but lose its permissions.',
      okText: 'Delete',
      onConfirm: async () => {
        await dispatch(deleteRole(role.id));
        await dispatch(fetchRoles());
      },
    });
  };

  const columns: ColumnsType<Role> = [
    { title: 'Role', dataIndex: 'name', key: 'name' },
    {
      title: 'Modules',
      key: 'modules',
      render: (_, role) =>
        role.permissions.length === 0 ? (
          <Typography.Text type="secondary">No permissions</Typography.Text>
        ) : (
          <Space size={[0, 4]} wrap>
            {role.permissions.map((permission) => (
              <Tag key={permission.module}>{MODULE_LABELS[permission.module]}</Tag>
            ))}
          </Space>
        ),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, role) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(role)}>
            Edit
          </Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDelete(role)}>
            Delete
          </Button>
        </Space>
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
          Roles &amp; Permissions
        </Typography.Title>
        <div className="flex items-center gap-2">
          <SearchInput value={searchText} onChange={setSearchText} placeholder="Search roles" />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Create role
          </Button>
        </div>
      </div>

      {error ? <Alert className="mb-4" type="error" message={error} showIcon /> : null}

      <DataTable<Role>
        columns={columns}
        rows={rows}
        loading={loading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={(nextPage, nextLimit) => dispatch(pageChanged({ page: nextPage, limit: nextLimit }))}
        emptyText="No roles yet"
        emptyHint="Create your first role to define what your team can access."
      />

      <RoleFormModal open={formOpen} role={editing} onClose={() => setFormOpen(false)} />
    </div>
  );
}
