import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, message, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { confirmAction } from '../../components/ConfirmDialog/confirmDialog';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectLeaveTypes, selectLeaveTypesError, selectLeaveTypesStatus } from '../../store/leaveAdmin/leaveAdminSelectors';
import { deleteLeaveType, fetchLeaveTypes } from '../../store/leaveAdmin/leaveAdminThunks';
import type { LeaveType } from '../../types/leave';
import { LeaveTypeFormModal } from './LeaveTypeFormModal';

type Editor = { open: false } | { open: true; record: LeaveType | null };

export default function LeaveTypesPage() {
  const dispatch = useAppDispatch();
  const types = useAppSelector(selectLeaveTypes);
  const status = useAppSelector(selectLeaveTypesStatus);
  const error = useAppSelector(selectLeaveTypesError);
  const [editor, setEditor] = useState<Editor>({ open: false });

  useEffect(() => {
    void dispatch(fetchLeaveTypes());
  }, [dispatch]);

  const onDelete = (t: LeaveType) =>
    confirmAction({
      title: `Delete ${t.name}?`,
      content: 'Past leave of this type keeps its history. If anyone has pending or approved leave of this type this year, deactivate it instead.',
      okText: 'Delete',
      onConfirm: async () => {
        const result = await dispatch(deleteLeaveType(t.id));
        if (deleteLeaveType.rejected.match(result)) {
          void message.error(result.payload ?? 'Could not delete the leave type');
        }
      },
    });

  const columns: ColumnsType<LeaveType> = [
    {
      title: 'Name',
      key: 'name',
      render: (_, t) => (
        <span className="flex items-center gap-2">
          {t.name} <Tag>{t.code}</Tag>
        </span>
      ),
    },
    { title: 'Days per year', key: 'quota', render: (_, t) => (t.yearlyQuota === null ? 'Unlimited' : t.yearlyQuota) },
    { title: 'Paid', key: 'paid', render: (_, t) => (t.isPaid ? 'Paid' : 'Unpaid') },
    { title: 'Half days', key: 'half', render: (_, t) => (t.allowHalfDay ? 'Allowed' : 'No') },
    { title: 'Status', key: 'status', render: (_, t) => (t.isActive ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>) },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_, t) => (
        <Space>
          <Tooltip title="Edit">
            <Button size="small" icon={<EditOutlined />} aria-label={`Edit ${t.name}`} onClick={() => setEditor({ open: true, record: t })} />
          </Tooltip>
          <Tooltip title="Delete">
            <Button size="small" danger icon={<DeleteOutlined />} aria-label={`Delete ${t.name}`} onClick={() => onDelete(t)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Typography.Title level={4} className="!mb-0">
          Leave types
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor({ open: true, record: null })}>
          Add leave type
        </Button>
      </div>
      {error ? <Alert className="mb-4" type="error" showIcon message={error} /> : null}
      <Card>
        <Typography.Paragraph type="secondary">
          Balances reset every January. Inactive types can't be applied for, but their past leave stays on record.
        </Typography.Paragraph>
        <Table<LeaveType> rowKey="id" columns={columns} dataSource={types} loading={status === 'loading'} pagination={false} scroll={{ x: 700 }} />
      </Card>
      <LeaveTypeFormModal open={editor.open} record={editor.open ? editor.record : null} onClose={() => setEditor({ open: false })} />
    </div>
  );
}
