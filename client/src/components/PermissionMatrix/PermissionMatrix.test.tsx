import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PermissionMatrix } from './PermissionMatrix';
import { emptyMatrix, setRowAll } from './permissionMatrix.logic';
import type { PermissionMatrixValue } from '../../types/role';

/** Wrapper that makes the controlled component usable in a test. */
function Harness({ initial }: { initial?: PermissionMatrixValue }) {
  const [value, setValue] = useState<PermissionMatrixValue>(initial ?? emptyMatrix());
  return <PermissionMatrix value={value} onChange={setValue} />;
}

const cb = (name: string) => screen.getByRole('checkbox', { name });

describe('PermissionMatrix', () => {
  it('disables create, update, and delete while read is unchecked', () => {
    render(<Harness />);
    expect(cb('employees create')).toBeDisabled();
    expect(cb('employees update')).toBeDisabled();
    expect(cb('employees delete')).toBeDisabled();
    expect(cb('employees read')).toBeEnabled();
  });

  it('enables the other actions once read is checked', async () => {
    render(<Harness />);
    await userEvent.click(cb('employees read'));
    expect(cb('employees create')).toBeEnabled();
    expect(cb('employees update')).toBeEnabled();
    expect(cb('employees delete')).toBeEnabled();
    expect(cb('employees create')).not.toBeChecked();
  });

  it('unchecking read clears and disables the other actions', async () => {
    render(<Harness initial={setRowAll(emptyMatrix(), 'employees', true)} />);
    expect(cb('employees create')).toBeChecked();

    await userEvent.click(cb('employees read'));

    expect(cb('employees create')).not.toBeChecked();
    expect(cb('employees create')).toBeDisabled();
  });

  it('row select-all checks every action in the row, and unchecking clears them', async () => {
    render(<Harness />);
    await userEvent.click(cb('employees select all'));
    expect(cb('employees read')).toBeChecked();
    expect(cb('employees delete')).toBeChecked();

    await userEvent.click(cb('employees select all'));
    expect(cb('employees read')).not.toBeChecked();
    expect(cb('employees delete')).not.toBeChecked();
  });

  it('the global toggle selects and deselects every permission', async () => {
    render(<Harness />);
    await userEvent.click(cb('select all permissions'));
    expect(cb('dashboard read')).toBeChecked();
    expect(cb('tasks delete')).toBeChecked();

    await userEvent.click(cb('select all permissions'));
    expect(cb('dashboard read')).not.toBeChecked();
    expect(cb('tasks delete')).not.toBeChecked();
  });

  it('renders a row per matrix module and none for role management', () => {
    render(<Harness />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Employees')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.queryByText('Roles')).not.toBeInTheDocument();
  });

  it('renders an inconsistent stored value (read:false, create:true) as checked-but-disabled', () => {
    const inconsistent = {
      ...emptyMatrix(),
      employees: { read: false, create: true, update: false, delete: false },
    };
    render(<Harness initial={inconsistent} />);

    const createCheckbox = screen.getByRole('checkbox', { name: 'employees create' });
    expect(createCheckbox).toBeChecked();
    expect(createCheckbox).toBeDisabled();
  });
});
