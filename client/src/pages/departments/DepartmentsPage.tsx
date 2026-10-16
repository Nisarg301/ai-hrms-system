import { EditOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Space, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { confirmAction } from '../../components/ConfirmDialog/confirmDialog';
import { DataTable } from '../../components/DataTable/DataTable';
import { SearchInput } from '../../components/SearchInput/SearchInput';
import { StatusTag } from '../../components/StatusTag/StatusTag';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { tokens } from '../../theme/tokens';
import { selectAuthUser } from '../../store/auth/authSelectors';
import {
  selectDepartments,
  selectDepartmentsError,
  selectDepartmentsLoading,
  selectDepartmentsPagination,
} from '../../store/departments/departmentsSelectors';
import { pageChanged, searchChanged } from '../../store/departments/departmentsSlice';
import { deleteDepartment, fetchDepartments } from '../../store/departments/departmentsThunks';
import type { DepartmentRow } from '../../types/department';
import { DepartmentFormModal } from './DepartmentFormModal';

export default function DepartmentsPage() {
  const dispatch = useAppDispatch();
  const authUser = useAppSelector(selectAuthUser);
  const rows = useAppSelector(selectDepartments);
  const loading = useAppSelector(selectDepartmentsLoading);
  const error = useAppSelector(selectDepartmentsError);
  const { page, limit, total } = useAppSelector(selectDepartmentsPagination);

  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebouncedValue(searchText, 300);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DepartmentRow | null>(null);

  // Writes are ORG_ADMIN-only on the API (requireOrgAdmin), regardless of the
  // departments permission grant, so the controls follow the role, not the matrix.
  const isOrgAdmin = authUser?.role === 'ORG_ADMIN';
  const canCreate = isOrgAdmin;
  const canUpdate = isOrgAdmin;
  const canDelete = isOrgAdmin;

  useEffect(() => {
    dispatch(searchChanged(debouncedSearch));
  }, [debouncedSearch, dispatch]);

  useEffect(() => {
    void dispatch(fetchDepartments());
  }, [dispatch, page, limit, debouncedSearch]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (row: DepartmentRow) => {
    setEditing(row);
    setFormOpen(true);
  };
  const onDelete = (row: DepartmentRow) => {
    confirmAction({
      title: `Delete ${row.title}?`,
      content: 'This removes the department record.',
      okText: 'Delete',
      onConfirm: async () => {
        await dispatch(deleteDepartment(row.id));
        await dispatch(fetchDepartments());
      },
    });
  };

  const columns: ColumnsType<DepartmentRow> = [
    { title: 'Title', dataIndex: 'title', key: 'title' },
    { title: 'Description', dataIndex: 'description', key: 'description' },
    { title: 'Status', key: 'status', render: (_, row) => <StatusTag status={row.status} /> },
  ];

  if (canUpdate || canDelete) {
    columns.push({
      title: 'Actions',
      key: 'actions',
      render: (_, row) => (
        <Space>
          {canUpdate ? (
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
              Edit
            </Button>
          ) : null}
          {canDelete ? (
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDelete(row)}>
              Delete
            </Button>
          ) : null}
        </Space>
      ),
    });
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4 pb-4" style={{ borderBottom: `1px solid ${tokens.colorBorder}` }}>
        <Typography.Title level={4} className="!mb-0" style={{ color: tokens.colorPrimaryDeep }}>
          Departments
        </Typography.Title>
        <div className="flex items-center gap-2">
          <SearchInput value={searchText} onChange={setSearchText} placeholder="Search title or description" />
          {canCreate ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Add Department
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <Alert className="mb-4" type="error" message={error} showIcon /> : null}

      <DataTable<DepartmentRow>
        columns={columns}
        rows={rows}
        loading={loading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={(nextPage, nextLimit) => dispatch(pageChanged({ page: nextPage, limit: nextLimit }))}
        emptyText="No departments yet"
        emptyHint="Add your first department to get started."
      />

      <DepartmentFormModal open={formOpen} record={editing} onClose={() => setFormOpen(false)} />
    </div>
  );
}
