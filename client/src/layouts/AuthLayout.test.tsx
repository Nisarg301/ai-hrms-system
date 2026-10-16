import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthLayout } from './AuthLayout';

function renderLayout() {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<div>Login Form</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('AuthLayout', () => {
  it('renders the routed page content', () => {
    renderLayout();
    expect(screen.getByText('Login Form')).toBeInTheDocument();
  });

  it('shows the Sentinel brand mark', () => {
    renderLayout();
    expect(screen.getAllByText('Sentinel').length).toBeGreaterThan(0);
  });
});
