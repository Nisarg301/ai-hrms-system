import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';

interface Row {
  id: string;
  name: string;
}

const columns = [{ title: 'Name', dataIndex: 'name', key: 'name' }];

describe('DataTable', () => {
  it('renders the rows it is given', () => {
    render(
      <DataTable<Row>
        columns={columns}
        rows={[{ id: '1', name: 'Ann' }]}
        loading={false}
        page={1}
        limit={10}
        total={1}
        onPageChange={vi.fn()}
      />
    );
    expect(screen.getByText('Ann')).toBeInTheDocument();
  });

  it('shows the empty text when there are no rows', () => {
    render(
      <DataTable<Row>
        columns={columns}
        rows={[]}
        loading={false}
        page={1}
        limit={10}
        total={0}
        onPageChange={vi.fn()}
        emptyText="No admin users yet"
      />
    );
    expect(screen.getByText('No admin users yet')).toBeInTheDocument();
  });

  it('shows the empty hint when one is given', () => {
    render(
      <DataTable<Row>
        columns={columns}
        rows={[]}
        loading={false}
        page={1}
        limit={10}
        total={0}
        onPageChange={vi.fn()}
        emptyText="No admin users yet"
        emptyHint="Invite your first Org Admin to get started."
      />
    );
    expect(screen.getByText('Invite your first Org Admin to get started.')).toBeInTheDocument();
  });

  it('reports page changes to the caller rather than slicing rows itself', async () => {
    const onPageChange = vi.fn();
    // total=25 with limit=10 means the server has 3 pages; the table renders
    // only the current page's rows.
    render(
      <DataTable<Row>
        columns={columns}
        rows={[{ id: '1', name: 'Ann' }]}
        loading={false}
        page={1}
        limit={10}
        total={25}
        onPageChange={onPageChange}
      />
    );

    await userEvent.click(screen.getByTitle('2'));

    expect(onPageChange).toHaveBeenCalledWith(2, 10);
  });
});
