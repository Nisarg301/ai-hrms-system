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
  selectProjects,
  selectProjectsError,
  selectProjectsLoading,
  selectProjectsPagination,
} from '../../store/projects/projectsSelectors';
import { pageChanged, searchChanged } from '../../store/projects/projectsSlice';
import { deleteProject, fetchProjects } from '../../store/projects/projectsThunks';
import type { ProjectRow } from '../../types/project';
import { ProjectFormModal } from './ProjectFormModal';

export default function ProjectsPage() {
  const dispatch = useAppDispatch();
  const can = useCan();
  const rows = useAppSelector(selectProjects);
  const loading = useAppSelector(selectProjectsLoading);
  const error = useAppSelector(selectProjectsError);
  const { page, limit, total } = useAppSelector(selectProjectsPagination);

  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebouncedValue(searchText, 300);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectRow | null>(null);

  const canCreate = can('projects', 'create');
  const canUpdate = can('projects', 'update');
  const canDelete = can('projects', 'delete');

  useEffect(() => {
    dispatch(searchChanged(debouncedSearch));
  }, [debouncedSearch, dispatch]);

  useEffect(() => {
    void dispatch(fetchProjects());
  }, [dispatch, page, limit, debouncedSearch]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (row: ProjectRow) => {
    setEditing(row);
    setFormOpen(true);
  };
  const onDelete = (row: ProjectRow) => {
    confirmAction({
      title: `Delete ${row.name}?`,
      content: 'This removes the project record.',
      okText: 'Delete',
      onConfirm: async () => {
        await dispatch(deleteProject(row.id));
        await dispatch(fetchProjects());
      },
    });
  };

  const columns: ColumnsType<ProjectRow> = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Description', dataIndex: 'description', key: 'description' },
    { title: 'Deadline', key: 'deadline', render: (_, row) => new Date(row.deadline).toLocaleDateString() },
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
          Projects
        </Typography.Title>
        <div className="flex items-center gap-2">
          <SearchInput value={searchText} onChange={setSearchText} placeholder="Search name" />
          {canCreate ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Add Project
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <Alert className="mb-4" type="error" message={error} showIcon /> : null}

      <DataTable<ProjectRow>
        columns={columns}
        rows={rows}
        loading={loading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={(nextPage, nextLimit) => dispatch(pageChanged({ page: nextPage, limit: nextLimit }))}
        emptyText="No projects yet"
        emptyHint="Add your first project to get started."
      />

      <ProjectFormModal open={formOpen} record={editing} onClose={() => setFormOpen(false)} />
    </div>
  );
}
