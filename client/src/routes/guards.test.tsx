import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { authReducer, type AuthState } from '../store/auth/authSlice';
import type { AuthUser } from '../types/auth';
import { MustChangePasswordGate } from './MustChangePasswordGate';
import { ProtectedRoute } from './ProtectedRoute';
import { RoleRoute } from './RoleRoute';

const ORG_ADMIN: AuthUser = {
  id: 'u1',
  name: 'Ann',
  email: 'ann@acme.com',
  role: 'ORG_ADMIN',
  organizationId: 'o1',
  roleId: null,
  mustChangePassword: false,
  permissions: { scope: 'all' },
};

function renderWithAuth(auth: Partial<AuthState>, initialPath: string, element: React.ReactNode) {
  const preloaded: AuthState = {
    user: null,
    status: 'unauthenticated',
    bootstrapped: true,
    error: null,
    resetToken: null,
    ...auth,
  };
  const store = configureStore({ reducer: { auth: authReducer }, preloadedState: { auth: preloaded } });

  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route path="/unauthorized" element={<div>Unauthorized Page</div>} />
          <Route path="/change-password" element={<div>Change Password Page</div>} />
          {element}
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

describe('ProtectedRoute', () => {
  it('redirects to login when unauthenticated', () => {
    renderWithAuth(
      { status: 'unauthenticated', bootstrapped: true },
      '/secret',
      <Route element={<ProtectedRoute />}>
        <Route path="/secret" element={<div>Secret</div>} />
      </Route>
    );
    expect(screen.getByText('Login Page')).toBeInTheDocument();
  });

  it('renders the child route when authenticated', () => {
    renderWithAuth(
      { status: 'authenticated', user: ORG_ADMIN, bootstrapped: true },
      '/secret',
      <Route element={<ProtectedRoute />}>
        <Route path="/secret" element={<div>Secret</div>} />
      </Route>
    );
    expect(screen.getByText('Secret')).toBeInTheDocument();
  });

  it('shows a loader instead of login while the session is still bootstrapping', () => {
    renderWithAuth(
      { status: 'loading', bootstrapped: false },
      '/secret',
      <Route element={<ProtectedRoute />}>
        <Route path="/secret" element={<div>Secret</div>} />
      </Route>
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
  });
});

describe('MustChangePasswordGate', () => {
  it('traps protected routes when mustChangePassword is true', () => {
    renderWithAuth(
      { status: 'authenticated', user: { ...ORG_ADMIN, mustChangePassword: true }, bootstrapped: true },
      '/secret',
      <Route element={<MustChangePasswordGate />}>
        <Route path="/secret" element={<div>Secret</div>} />
      </Route>
    );
    expect(screen.getByText('Change Password Page')).toBeInTheDocument();
    expect(screen.queryByText('Secret')).not.toBeInTheDocument();
  });

  it('lets the user through once the flag is cleared', () => {
    renderWithAuth(
      { status: 'authenticated', user: ORG_ADMIN, bootstrapped: true },
      '/secret',
      <Route element={<MustChangePasswordGate />}>
        <Route path="/secret" element={<div>Secret</div>} />
      </Route>
    );
    expect(screen.getByText('Secret')).toBeInTheDocument();
  });

  it('does not trap the change-password route itself', () => {
    renderWithAuth(
      { status: 'authenticated', user: { ...ORG_ADMIN, mustChangePassword: true }, bootstrapped: true },
      '/change-password',
      <Route element={<MustChangePasswordGate />}>
        <Route path="/other" element={<div>Other</div>} />
      </Route>
    );
    expect(screen.getByText('Change Password Page')).toBeInTheDocument();
  });
});

describe('RoleRoute', () => {
  it('renders the child route when the role matches', () => {
    renderWithAuth(
      { status: 'authenticated', user: ORG_ADMIN, bootstrapped: true },
      '/roles',
      <Route element={<RoleRoute allow={['ORG_ADMIN']} />}>
        <Route path="/roles" element={<div>Roles Page</div>} />
      </Route>
    );
    expect(screen.getByText('Roles Page')).toBeInTheDocument();
  });

  it('redirects to unauthorized when the role does not match', () => {
    renderWithAuth(
      { status: 'authenticated', user: { ...ORG_ADMIN, role: 'SUPER_ADMIN' }, bootstrapped: true },
      '/roles',
      <Route element={<RoleRoute allow={['ORG_ADMIN']} />}>
        <Route path="/roles" element={<div>Roles Page</div>} />
      </Route>
    );
    expect(screen.getByText('Unauthorized Page')).toBeInTheDocument();
  });
});
