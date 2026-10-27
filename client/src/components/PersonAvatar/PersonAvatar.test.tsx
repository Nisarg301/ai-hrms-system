import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from '../../theme/ThemeContext';
import { initialOf, PersonAvatar } from './PersonAvatar';

describe('PersonAvatar', () => {
  afterEach(() => localStorage.clear());

  it("uses the name's first letter, as the header's account menu does", () => {
    expect(initialOf('Aakash')).toBe('A');
    expect(initialOf('Ivy Mehta')).toBe('I');
    expect(initialOf('  ivy rose')).toBe('I');
    expect(initialOf('  ')).toBe('?');
    // By character, not by UTF-16 unit: no half an emoji.
    expect(initialOf('😀 Sam')).toBe('😀');
  });

  it('shows the photo when there is one, else the initial', () => {
    const { rerender } = render(<PersonAvatar name="Ivy Mehta" avatarUrl={null} />);
    expect(screen.getByText('I')).toBeInTheDocument();
    rerender(<PersonAvatar name="Ivy Mehta" avatarUrl="http://x/a.png" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://x/a.png');
  });

  it("uses the header's colours for everyone: a white letter on the deep theme colour", () => {
    render(
      <>
        <PersonAvatar name="Ivy Mehta" avatarUrl={null} />
        <PersonAvatar name="Rahul Verma" avatarUrl={null} />
      </>
    );
    // Outside a ThemeProvider: the default (blue) light theme.
    for (const name of ['Ivy Mehta', 'Rahul Verma']) expect(screen.getByLabelText(name)).toHaveStyle({ background: '#0b3a4a', color: '#ffffff' });
  });

  it('puts a dark letter on the bright theme colour in dark mode, for contrast', () => {
    localStorage.setItem('theme_mode', 'dark');
    localStorage.setItem('theme_color', 'green');
    render(
      <ThemeProvider>
        <PersonAvatar name="Ivy Mehta" avatarUrl={null} />
      </ThemeProvider>
    );
    expect(screen.getByLabelText('Ivy Mehta')).toHaveStyle({ background: '#34d399', color: '#021a14' });
  });
});
