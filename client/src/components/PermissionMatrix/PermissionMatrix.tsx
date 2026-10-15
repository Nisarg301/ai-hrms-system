import { Checkbox, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { MODULE_LABELS, MODULES } from '../../constants/modules';
import type { ModuleName, PermissionAction, PermissionMatrixValue } from '../../types/role';
import { globalState, rowState, setAction, setGlobalAll, setRowAll } from './permissionMatrix.logic';

interface PermissionMatrixProps {
  value: PermissionMatrixValue;
  onChange: (next: PermissionMatrixValue) => void;
  /** Rows to show: the organization's plan modules. Defaults to every module. */
  modules?: readonly ModuleName[];
}

interface Row {
  module: ModuleName;
}

const ACTIONS: PermissionAction[] = ['read', 'create', 'update', 'delete'];
const ACTION_LABELS: Record<PermissionAction, string> = {
  read: 'Read',
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
};

/**
 * Fully controlled: owns no state, reads no store, fetches nothing. All rules
 * live in permissionMatrix.logic.ts.
 */
export function PermissionMatrix({ value, onChange, modules = MODULES }: PermissionMatrixProps) {
  const rows: Row[] = modules.map((module) => ({ module }));
  const global = globalState(value, modules);

  const actionColumns: ColumnsType<Row> = ACTIONS.map((action) => ({
    title: ACTION_LABELS[action],
    key: action,
    render: (_: unknown, row: Row) => {
      const flags = value[row.module];
      return (
        <Checkbox
          aria-label={`${row.module} ${action}`}
          checked={flags[action]}
          // Read gates the rest: the others are unusable until read is on.
          disabled={action !== 'read' && !flags.read}
          onChange={(event) => onChange(setAction(value, row.module, action, event.target.checked))}
        />
      );
    },
  }));

  const columns: ColumnsType<Row> = [
    {
      title: 'Module',
      key: 'module',
      render: (_: unknown, row: Row) => MODULE_LABELS[row.module],
    },
    ...actionColumns,
    {
      title: 'Select All',
      key: 'selectAll',
      render: (_: unknown, row: Row) => {
        const state = rowState(value[row.module]);
        return (
          <Checkbox
            aria-label={`${row.module} select all`}
            checked={state === 'all'}
            indeterminate={state === 'some'}
            onChange={(event) => onChange(setRowAll(value, row.module, event.target.checked))}
          />
        );
      },
    },
  ];

  return (
    <div>
      <div className="mb-3">
        <Checkbox
          aria-label="select all permissions"
          checked={global === 'all'}
          indeterminate={global === 'some'}
          onChange={(event) => onChange(setGlobalAll(value, event.target.checked, modules))}
        >
          {global === 'all' ? 'Deselect all permissions' : 'Select all permissions'}
        </Checkbox>
      </div>
      <Table<Row> columns={columns} dataSource={rows} rowKey="module" pagination={false} size="small" />
    </div>
  );
}
