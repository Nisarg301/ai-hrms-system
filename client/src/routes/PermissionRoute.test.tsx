import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { authReducer, type AuthState } from '../store/auth/authSlice';
import type { AuthUser, EffectivePermissions } from '../types/auth';
import { PermissionRoute } from './PermissionRoute';

function baseUser(permissions: EffectivePermissions): AuthUser {
  return {
    id: 'u1',
    name: 'U',
    email: 'u@x.com',
    role: 'ORG_USER',
    organizationId: 'o1',
    roleId: 'r1',
    mustChangePassword: false,
    permissions,
  };
}

function renderGuard(permissions: EffectivePermissions) {
  const preloaded: AuthState = { user: baseUser(permissions), status: 'authenticated', bootstrapped: true, error: null, resetToken: null };
  const store = configureStore({ reducer: { auth: authReducer }, preloadedState: { auth: preloaded } });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/employees']}>
        <Routes>
          <Route element={<PermissionRoute module="employees" />}>
            <Route path="/employees" element={<div>Employees Content</div>} />
          </Route>
          <Route path="/unauthorized" element={<div>Unauthorized Page</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

describe('PermissionRoute', () => {
  it('renders the route when the user can read the module', () => {
    renderGuard({ scope: 'matrix', entries: [{ module: 'employees', read: true, create: false, update: false, delete: false }] });
    expect(screen.getByText('Employees Content')).toBeInTheDocument();
  });

  it('redirects to /unauthorized when the user cannot read the module', () => {
    renderGuard({ scope: 'matrix', entries: [] });
    expect(screen.getByText('Unauthorized Page')).toBeInTheDocument();
  });

  it('always allows an ORG_ADMIN (scope all)', () => {
    renderGuard({ scope: 'all' });
    expect(screen.getByText('Employees Content')).toBeInTheDocument();
  });
});
