import { EditOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Space, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { confirmAction } from '../../components/ConfirmDialog/confirmDialog';
import { DataTable } from '../../components/DataTable/DataTable';
import { SearchInput } from '../../components/SearchInput/SearchInput';
import { StatusTag } from '../../components/StatusTag/StatusTag';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { useCan } from '../../hooks/useCan';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { tokens } from '../../theme/tokens';
import {
  selectTasks,
  selectTasksError,
  selectTasksLoading,
  selectTasksPagination,
} from '../../store/tasks/tasksSelectors';
import { pageChanged, searchChanged } from '../../store/tasks/tasksSlice';
import { deleteTask, fetchTasks } from '../../store/tasks/tasksThunks';
import type { TaskRow } from '../../types/task';
import { TaskFormModal } from './TaskFormModal';

export default function TasksPage() {
  const dispatch = useAppDispatch();
  const can = useCan();
  const rows = useAppSelector(selectTasks);
  const loading = useAppSelector(selectTasksLoading);
  const error = useAppSelector(selectTasksError);
  const { page, limit, total } = useAppSelector(selectTasksPagination);
  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebouncedValue(searchText, 300);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TaskRow | null>(null);

  const canCreate = can('tasks', 'create');
  const canUpdate = can('tasks', 'update');
  const canDelete = can('tasks', 'delete');

  useEffect(() => {
    dispatch(searchChanged(debouncedSearch));
  }, [debouncedSearch, dispatch]);

  useEffect(() => {
    void dispatch(fetchTasks());
  }, [dispatch, page, limit, debouncedSearch]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (row: TaskRow) => {
    setEditing(row);
    setFormOpen(true);
  };
  const onDelete = (row: TaskRow) => {
    confirmAction({
      title: `Delete ${row.title}?`,
      content: 'This removes the task record.',
      okText: 'Delete',
      onConfirm: async () => {
        await dispatch(deleteTask(row.id));
        await dispatch(fetchTasks());
      },
    });
  };

  const columns: ColumnsType<TaskRow> = [
    { title: 'Project', dataIndex: 'projectName', key: 'projectName' },
    { title: 'Users', dataIndex: 'userName', key: 'userName' },
    { title: 'Title', dataIndex: 'title', key: 'title' },
    { title: 'Description', dataIndex: 'description', key: 'description' },
    { title: 'Due date', dataIndex: 'dueDate', key: 'dueDate' },
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
          Tasks
        </Typography.Title>
        <div className="flex items-center gap-2">
          <SearchInput value={searchText} onChange={setSearchText} placeholder="Search title" />
          {canCreate ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Add Task
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <Alert className="mb-4" type="error" message={error} showIcon /> : null}

      <DataTable<TaskRow>
        columns={columns}
        rows={rows}
        loading={loading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={(nextPage, nextLimit) => dispatch(pageChanged({ page: nextPage, limit: nextLimit }))}
        emptyText="No tasks yet"
        emptyHint="Add your first task to get started."
      />

      <TaskFormModal open={formOpen} record={editing} onClose={() => setFormOpen(false)} />
    </div>
  );
}
