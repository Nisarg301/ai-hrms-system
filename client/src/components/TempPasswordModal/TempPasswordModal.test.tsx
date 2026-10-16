import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TempPasswordModal } from './TempPasswordModal';

describe('TempPasswordModal', () => {
  it('shows the temporary password and the one-time warning', () => {
    render(<TempPasswordModal open password="Tmp!23456789" onClose={vi.fn()} />);
    expect(screen.getByText('Tmp!23456789')).toBeInTheDocument();
    expect(screen.getByText(/will not be shown again/i)).toBeInTheDocument();
  });

  it('renders nothing when there is no password', () => {
    render(<TempPasswordModal open={false} password={null} onClose={vi.fn()} />);
    expect(screen.queryByText(/will not be shown again/i)).not.toBeInTheDocument();
  });

  it('calls onClose when dismissed', async () => {
    const onClose = vi.fn();
    render(<TempPasswordModal open password="Tmp!23456789" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
