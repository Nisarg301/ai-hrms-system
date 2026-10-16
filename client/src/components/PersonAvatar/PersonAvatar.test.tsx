import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { initials, PersonAvatar } from './PersonAvatar';

describe('PersonAvatar', () => {
  it('uses first and last initials', () => {
    expect(initials('Ivy Mehta')).toBe('IM');
    expect(initials('Ivy Rose Mehta')).toBe('IM');
    expect(initials('ivy')).toBe('IV');
    expect(initials('  ')).toBe('?');
  });

  it('shows the photo when there is one, else the initials', () => {
    const { rerender } = render(<PersonAvatar name="Ivy Mehta" avatarUrl={null} />);
    expect(screen.getByText('IM')).toBeInTheDocument();
    rerender(<PersonAvatar name="Ivy Mehta" avatarUrl="http://x/a.png" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://x/a.png');
  });
});
