import { EditOutlined, DeleteOutlined, PlusOutlined, DownloadOutlined } from '@ant-design/icons';
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
  selectDocuments,
  selectDocumentsError,
  selectDocumentsLoading,
  selectDocumentsPagination,
} from '../../store/documents/documentsSelectors';
import { pageChanged, searchChanged } from '../../store/documents/documentsSlice';
import { deleteDocument, downloadDocumentFile, fetchDocuments } from '../../store/documents/documentsThunks';
import type { DocumentRow } from '../../types/document';
import { DocumentFormModal } from './DocumentFormModal';

export default function DocumentsPage() {
  const dispatch = useAppDispatch();
  const can = useCan();
  const rows = useAppSelector(selectDocuments);
  const loading = useAppSelector(selectDocumentsLoading);
  const error = useAppSelector(selectDocumentsError);
  const { page, limit, total } = useAppSelector(selectDocumentsPagination);

  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebouncedValue(searchText, 300);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentRow | null>(null);

  const canCreate = can('documents', 'create');
  const canUpdate = can('documents', 'update');
  const canDelete = can('documents', 'delete');

  useEffect(() => {
    dispatch(searchChanged(debouncedSearch));
  }, [debouncedSearch, dispatch]);

  useEffect(() => {
    void dispatch(fetchDocuments());
  }, [dispatch, page, limit, debouncedSearch]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (row: DocumentRow) => {
    setEditing(row);
    setFormOpen(true);
  };
  const onDelete = (row: DocumentRow) => {
    confirmAction({
      title: `Delete ${row.title}?`,
      content: 'This removes the document record.',
      okText: 'Delete',
      onConfirm: async () => {
        await dispatch(deleteDocument(row.id));
        await dispatch(fetchDocuments());
      },
    });
  };

  const handleDownload = (row: DocumentRow) => {
    void dispatch(downloadDocumentFile(row.id));
  };

  const columns: ColumnsType<DocumentRow> = [
    { title: 'Title', dataIndex: 'title', key: 'title' },
    { title: 'Description', dataIndex: 'description', key: 'description' },
    { title: 'Category', dataIndex: 'category', key: 'category' },
    { title: 'Status', key: 'status', render: (_, row) => <StatusTag status={row.status} /> },
  ];

  // Always present: anyone who can see this page (documents: read) may download
  // an attachment, even without update/delete rights.
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
        {row.file ? (
          <Button size="small" icon={<DownloadOutlined />} onClick={() => handleDownload(row)}>
            Download
          </Button>
        ) : null}
      </Space>
    ),
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4 pb-4" style={{ borderBottom: `1px solid ${tokens.colorBorder}` }}>
        <Typography.Title level={4} className="!mb-0" style={{ color: tokens.colorPrimaryDeep }}>
          Documents
        </Typography.Title>
        <div className="flex items-center gap-2">
          <SearchInput value={searchText} onChange={setSearchText} placeholder="Search title or category" />
          {canCreate ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Add Document
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <Alert className="mb-4" type="error" message={error} showIcon /> : null}

      <DataTable<DocumentRow>
        columns={columns}
        rows={rows}
        loading={loading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={(nextPage, nextLimit) => dispatch(pageChanged({ page: nextPage, limit: nextLimit }))}
        emptyText="No documents yet"
        emptyHint="Add your first document to get started."
      />

      <DocumentFormModal open={formOpen} record={editing} onClose={() => setFormOpen(false)} />
    </div>
  );
}
