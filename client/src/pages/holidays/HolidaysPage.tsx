import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, message, Select, Space, Table, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { confirmAction } from '../../components/ConfirmDialog/confirmDialog';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectHolidays, selectHolidaysError, selectHolidaysStatus } from '../../store/holidays/holidaysSelectors';
import { deleteHoliday, fetchHolidays } from '../../store/holidays/holidaysThunks';
import type { Holiday } from '../../types/holiday';
import { HolidayFormModal } from './HolidayFormModal';

type Editor = { open: false } | { open: true; record: Holiday | null };

export default function HolidaysPage() {
  const dispatch = useAppDispatch();
  const holidays = useAppSelector(selectHolidays);
  const status = useAppSelector(selectHolidaysStatus);
  const error = useAppSelector(selectHolidaysError);
  const thisYear = dayjs().year();
  const [year, setYear] = useState(thisYear);
  const [editor, setEditor] = useState<Editor>({ open: false });

  useEffect(() => {
    void dispatch(fetchHolidays(year));
  }, [dispatch, year]);

  const onDelete = (h: Holiday) =>
    confirmAction({
      title: `Delete ${h.name}?`,
      content: `${dayjs(h.date).format('DD MMM YYYY')} will count as a working day again for new leave requests.`,
      okText: 'Delete',
      onConfirm: async () => {
        const result = await dispatch(deleteHoliday(h.id));
        if (deleteHoliday.rejected.match(result)) {
          void message.error(result.payload ?? 'Could not delete the holiday');
        }
      },
    });

  const columns: ColumnsType<Holiday> = [
    { title: 'Date', key: 'date', render: (_, h) => dayjs(h.date).format('ddd, DD MMM YYYY') },
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Description', dataIndex: 'description', key: 'description', render: (d: string) => d || '—' },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_, h) => (
        <Space>
          <Tooltip title="Edit">
            <Button size="small" icon={<EditOutlined />} aria-label={`Edit ${h.name}`} onClick={() => setEditor({ open: true, record: h })} />
          </Tooltip>
          <Tooltip title="Delete">
            <Button size="small" danger icon={<DeleteOutlined />} aria-label={`Delete ${h.name}`} onClick={() => onDelete(h)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Typography.Title level={4} className="!mb-0">
          Holidays
        </Typography.Title>
        <Space>
          <Select
            aria-label="Year"
            value={year}
            onChange={setYear}
            options={[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => ({ value: y, label: String(y) }))}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor({ open: true, record: null })}>
            Add holiday
          </Button>
        </Space>
      </div>
      {error ? <Alert className="mb-4" type="error" showIcon message={error} /> : null}
      <Card>
        <Typography.Paragraph type="secondary">Holidays aren't counted as leave days, and everyone sees them on Home and in Me → Holidays.</Typography.Paragraph>
        <Table<Holiday>
          rowKey="id"
          columns={columns}
          dataSource={holidays}
          loading={status === 'loading'}
          pagination={false}
          scroll={{ x: 600 }}
          locale={{ emptyText: <EmptyState title={`No holidays for ${year} yet`} hint="Add your organization's holidays so leave counts skip them." /> }}
        />
      </Card>
      <HolidayFormModal open={editor.open} record={editor.open ? editor.record : null} year={year} onClose={() => setEditor({ open: false })} />
    </div>
  );
}
