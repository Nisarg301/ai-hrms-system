import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeContext';

describe('ThemeContext', () => {
  beforeEach(() => {
    try {
      window.localStorage?.clear();
    } catch {
      // ignore
    }
    document.documentElement.className = '';
  });

  it('provides default system theme and responds to mode change', async () => {
    const user = userEvent.setup();

    function TestComponent() {
      const { themeMode, isDarkMode, setThemeMode, toggleDarkMode } = useTheme();
      return (
        <div>
          <span data-testid="mode">{themeMode}</span>
          <span data-testid="isDark">{isDarkMode ? 'dark' : 'light'}</span>
          <button onClick={() => setThemeMode('dark')}>Set Dark</button>
          <button onClick={() => setThemeMode('light')}>Set Light</button>
          <button onClick={() => toggleDarkMode()}>Toggle</button>
        </div>
      );
    }

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('mode').textContent).toBe('system');

    await user.click(screen.getByRole('button', { name: 'Set Dark' }));
    expect(screen.getByTestId('mode').textContent).toBe('dark');
    expect(screen.getByTestId('isDark').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('theme_mode')).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Set Light' }));
    expect(screen.getByTestId('mode').textContent).toBe('light');
    expect(screen.getByTestId('isDark').textContent).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('theme_mode')).toBe('light');

    await user.click(screen.getByRole('button', { name: 'Toggle' }));
    expect(screen.getByTestId('mode').textContent).toBe('dark');
    expect(screen.getByTestId('isDark').textContent).toBe('dark');
  });

  it('provides theme color selection and updates CSS properties and persistence', async () => {
    const user = userEvent.setup();

    function ColorTestComponent() {
      const { themeColor, setThemeColor, tokens } = useTheme();
      return (
        <div>
          <span data-testid="color">{themeColor}</span>
          <span data-testid="primary">{tokens.colorPrimary}</span>
          <button onClick={() => setThemeColor('purple')}>Set Purple</button>
          <button onClick={() => setThemeColor('green')}>Set Green</button>
        </div>
      );
    }

    render(
      <ThemeProvider>
        <ColorTestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('color').textContent).toBe('blue');

    await user.click(screen.getByRole('button', { name: 'Set Purple' }));
    expect(screen.getByTestId('color').textContent).toBe('purple');
    expect(localStorage.getItem('theme_color')).toBe('purple');
    expect(document.documentElement.style.getPropertyValue('--theme-accent')).toBe('#8b5cf6');

    await user.click(screen.getByRole('button', { name: 'Set Green' }));
    expect(screen.getByTestId('color').textContent).toBe('green');
    expect(localStorage.getItem('theme_color')).toBe('green');
    expect(document.documentElement.style.getPropertyValue('--theme-accent')).toBe('#10b981');
  });

  it('throws error when useTheme is used outside of ThemeProvider', () => {
    expect(() => {
      renderHook(() => useTheme());
    }).toThrow('useTheme must be used within a ThemeProvider');
  });
});
