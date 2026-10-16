import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="No admin users yet" />);
    expect(screen.getByText('No admin users yet')).toBeInTheDocument();
  });

  it('renders the hint when given, and omits it when not', () => {
    const { rerender } = render(<EmptyState title="No roles yet" hint="Create your first role to get started." />);
    expect(screen.getByText('Create your first role to get started.')).toBeInTheDocument();

    rerender(<EmptyState title="No roles yet" />);
    expect(screen.queryByText(/get started/)).not.toBeInTheDocument();
  });
});
