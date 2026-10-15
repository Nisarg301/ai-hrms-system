import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, message, Space, Switch, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { confirmAction } from '../../components/ConfirmDialog/confirmDialog';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectExpensesAdmin } from '../../store/expensesAdmin/expensesAdminSelectors';
import { deleteCategory, fetchAllCategories, saveCategory } from '../../store/expensesAdmin/expensesAdminThunks';
import type { ExpenseCategory } from '../../types/expense';
import { formatInrExact } from '../../utils/formatInr';
import { CategoryFormModal } from './CategoryFormModal';

type Editor = { open: false } | { open: true; record: ExpenseCategory | null };

/** Categories with their limit and receipt rule; used ones can be switched off but not deleted. */
export function CategoriesTab() {
  const dispatch = useAppDispatch();
  const { categories, categoriesStatus, categoriesError } = useAppSelector(selectExpensesAdmin);
  const [editor, setEditor] = useState<Editor>({ open: false });
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    void dispatch(fetchAllCategories());
  }, [dispatch]);

  const onToggle = async (c: ExpenseCategory, isActive: boolean) => {
    setToggling(c.id);
    const result = await dispatch(saveCategory({ id: c.id, payload: { isActive } }));
    setToggling(null);
    if (saveCategory.rejected.match(result)) void message.error(result.payload?.message ?? 'Could not update the category');
  };

  const onDelete = (c: ExpenseCategory) =>
    confirmAction({
      title: `Delete ${c.name}?`,
      content: 'It can only be deleted while no expense uses it. Otherwise, switch it off instead.',
      okText: 'Delete',
      onConfirm: async () => {
        const result = await dispatch(deleteCategory(c.id));
        if (deleteCategory.rejected.match(result)) void message.error(result.payload ?? 'Could not delete the category');
        else void message.success(`Deleted ${c.name}`);
      },
    });

  const columns: ColumnsType<ExpenseCategory> = [
    {
      title: 'Name',
      key: 'name',
      render: (_, c) => (
        <span className="flex items-center gap-2">
          {c.name}
          {c.isActive ? null : <Tag>Inactive</Tag>}
        </span>
      ),
    },
    { title: 'Limit per expense', key: 'limit', render: (_, c) => (c.limitPaise === null ? 'No limit' : formatInrExact(c.limitPaise)) },
    {
      title: 'Receipt needed',
      key: 'receipt',
      render: (_, c) => (c.receiptRequiredAbovePaise === 0 ? 'Always' : `Above ${formatInrExact(c.receiptRequiredAbovePaise)}`),
    },
    {
      title: 'Active',
      key: 'active',
      render: (_, c) => (
        <Switch size="small" checked={c.isActive} loading={toggling === c.id} aria-label={`${c.name} active`} onChange={(v) => onToggle(c, v)} />
      ),
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_, c) => (
        <Space>
          <Tooltip title="Edit">
            <Button type="text" size="small" icon={<EditOutlined />} aria-label={`Edit ${c.name}`} onClick={() => setEditor({ open: true, record: c })} />
          </Tooltip>
          <Tooltip title="Delete">
            <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={`Delete ${c.name}`} onClick={() => onDelete(c)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor({ open: true, record: null })}>
          New category
        </Button>
      </div>
      {categoriesError ? <Alert className="mb-4" type="error" showIcon message={categoriesError} /> : null}
      <Table<ExpenseCategory>
        rowKey="id"
        columns={columns}
        dataSource={categories}
        loading={categoriesStatus === 'loading'}
        pagination={false}
        scroll={{ x: 700 }}
      />
      <CategoryFormModal open={editor.open} record={editor.open ? editor.record : null} onClose={() => setEditor({ open: false })} />
    </>
  );
}
