import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EmptyState } from '../EmptyState/EmptyState';

interface DataTableProps<T> {
  columns: ColumnsType<T>;
  rows: T[];
  loading: boolean;
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number, limit: number) => void;
  emptyText?: string;
  emptyHint?: string;
  rowKey?: keyof T & string;
}

/**
 * Server-driven table: it renders exactly the rows it is handed and reports
 * pagination intent upward. It never slices or filters — the server owns that.
 */
export function DataTable<T extends object>({
  columns,
  rows,
  loading,
  page,
  limit,
  total,
  onPageChange,
  emptyText = 'No data',
  emptyHint,
  rowKey = 'id' as keyof T & string,
}: DataTableProps<T>) {
  return (
    <Table<T>
      columns={columns}
      dataSource={rows}
      loading={loading}
      rowKey={rowKey}
      locale={{ emptyText: <EmptyState title={emptyText} hint={emptyHint} /> }}
      pagination={{
        current: page,
        pageSize: limit,
        total,
        showSizeChanger: true,
        onChange: onPageChange,
      }}
    />
  );
}
