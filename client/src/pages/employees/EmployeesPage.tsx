import { EditOutlined, DeleteOutlined, LogoutOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Space, Tag, Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { confirmAction } from '../../components/ConfirmDialog/confirmDialog';
import { DataTable } from '../../components/DataTable/DataTable';
import { StartProcessModal } from '../../components/Lifecycle/StartProcessModal';
import { SearchInput } from '../../components/SearchInput/SearchInput';
import { StatusTag } from '../../components/StatusTag/StatusTag';
import { TempPasswordModal } from '../../components/TempPasswordModal/TempPasswordModal';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { tokens } from '../../theme/tokens';
import { selectAuthUser } from '../../store/auth/authSelectors';
import {
  selectEmployees,
  selectEmployeesError,
  selectEmployeesLoading,
  selectEmployeesPagination,
  selectEmployeesTempPassword,
} from '../../store/employees/employeesSelectors';
import { pageChanged, searchChanged, tempPasswordCleared } from '../../store/employees/employeesSlice';
import { deleteEmployee, fetchEmployees } from '../../store/employees/employeesThunks';
import type { EmployeeRow } from '../../types/employee';
import { EmployeeFormModal } from './EmployeeFormModal';

export default function EmployeesPage() {
  const dispatch = useAppDispatch();
  const authUser = useAppSelector(selectAuthUser);
  const rows = useAppSelector(selectEmployees);
  const loading = useAppSelector(selectEmployeesLoading);
  const error = useAppSelector(selectEmployeesError);
  const tempPassword = useAppSelector(selectEmployeesTempPassword);
  const { page, limit, total } = useAppSelector(selectEmployeesPagination);

  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebouncedValue(searchText, 300);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [offboarding, setOffboarding] = useState<EmployeeRow | null>(null);

  // Creating, editing, and deleting an employee also creates/changes a login
  // account and its role, so -- unlike every other module -- these actions
  // require ORG_ADMIN outright rather than the 'employees' permission grant.
  const isOrgAdmin = authUser?.role === 'ORG_ADMIN';

  useEffect(() => {
    dispatch(searchChanged(debouncedSearch));
  }, [debouncedSearch, dispatch]);

  useEffect(() => {
    void dispatch(fetchEmployees());
  }, [dispatch, page, limit, debouncedSearch]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (employee: EmployeeRow) => {
    setEditing(employee);
    setFormOpen(true);
  };
  const onDelete = (employee: EmployeeRow) => {
    confirmAction({
      title: `Delete ${employee.name}?`,
      content: 'This removes the employee record and revokes their access.',
      okText: 'Delete',
      onConfirm: async () => {
        await dispatch(deleteEmployee(employee.id));
        await dispatch(fetchEmployees());
      },
    });
  };

  const today = dayjs().format('YYYY-MM-DD');
  const columns: ColumnsType<EmployeeRow> = [
    {
      title: 'Name',
      key: 'name',
      render: (_, row) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          {row.name}
          {row.lifecycle?.kind === 'onboarding' ? <Tag color="blue">Onboarding</Tag> : null}
          {row.lifecycle?.kind === 'offboarding' ? (
            <Tag color="orange">
              {row.lifecycle.anchorDate < today ? 'Left' : 'Leaving'} on {dayjs(row.lifecycle.anchorDate).format('D MMM')}
            </Tag>
          ) : null}
        </span>
      ),
    },
    { title: 'Email', dataIndex: 'email', key: 'email' },
    { title: 'Job Title', dataIndex: 'jobTitle', key: 'jobTitle' },
    { title: 'Department', dataIndex: 'departmentName', key: 'department' },
    { title: 'Reports to', key: 'reportsTo', render: (_, row) => row.reportsToName ?? <Typography.Text type="secondary">—</Typography.Text> },
    { title: 'Role', key: 'role', render: (_, row) => row.roleName ?? <Typography.Text type="secondary">—</Typography.Text> },
    { title: 'Status', key: 'status', render: (_, row) => <StatusTag status={row.status} /> },
  ];

  if (isOrgAdmin) {
    columns.push({
      title: 'Actions',
      key: 'actions',
      render: (_, row) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            Edit
          </Button>
          {row.lifecycle?.kind !== 'offboarding' && row.status === 'active' ? (
            <Tooltip title="Start offboarding">
              <Button size="small" icon={<LogoutOutlined />} onClick={() => setOffboarding(row)} aria-label={`Start offboarding for ${row.name}`}>
                Offboard
              </Button>
            </Tooltip>
          ) : null}
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDelete(row)}>
            Delete
          </Button>
        </Space>
      ),
    });
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4 pb-4" style={{ borderBottom: `1px solid ${tokens.colorBorder}` }}>
        <Typography.Title level={4} className="!mb-0" style={{ color: tokens.colorPrimaryDeep }}>
          Employees
        </Typography.Title>
        <div className="flex items-center gap-2">
          <SearchInput value={searchText} onChange={setSearchText} placeholder="Search name or email" />
          {isOrgAdmin ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Add Employee
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <Alert className="mb-4" type="error" message={error} showIcon /> : null}

      <DataTable<EmployeeRow>
        columns={columns}
        rows={rows}
        loading={loading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={(nextPage, nextLimit) => dispatch(pageChanged({ page: nextPage, limit: nextLimit }))}
        emptyText="No employees yet"
        emptyHint="Add your first employee to get started."
      />

      <EmployeeFormModal open={formOpen} employee={editing} onClose={() => setFormOpen(false)} />
      <StartProcessModal
        kind="offboarding"
        open={offboarding !== null}
        employeeId={offboarding?.id ?? null}
        onClose={() => setOffboarding(null)}
        onStarted={() => void dispatch(fetchEmployees())}
      />

      <TempPasswordModal open={tempPassword !== null} password={tempPassword} onClose={() => dispatch(tempPasswordCleared())} />
    </div>
  );
}
