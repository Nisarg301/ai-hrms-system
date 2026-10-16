import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import RolesPage from './RolesPage';

const ROLE = {
  id: 'r1',
  name: 'Manager',
  permissions: [{ module: 'employees', read: true, create: true, update: false, delete: false }],
};

function renderPage() {
  const store = makeTestStore();
  render(
    <Provider store={store}>
      <MemoryRouter>
        <RolesPage />
      </MemoryRouter>
    </Provider>
  );
  return store;
}

describe('RolesPage', () => {
  it('lists roles with a summary of their modules', async () => {
    server.use(
      http.get(`${API_BASE_URL}/roles`, () =>
        HttpResponse.json({ success: true, data: [ROLE], meta: { page: 1, limit: 10, total: 1 } })
      )
    );
    renderPage();

    expect(await screen.findByText('Manager')).toBeInTheDocument();
    expect(screen.getByText(/employees/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no roles', async () => {
    server.use(
      http.get(`${API_BASE_URL}/roles`, () =>
        HttpResponse.json({ success: true, data: [], meta: { page: 1, limit: 10, total: 0 } })
      )
    );
    renderPage();

    expect(await screen.findByText(/no roles yet/i)).toBeInTheDocument();
    expect(screen.getByText('Create your first role to define what your team can access.')).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    server.use(
      http.get(`${API_BASE_URL}/roles`, () =>
        HttpResponse.json({ success: false, error: { message: 'Organization Admin access required' } }, { status: 403 })
      )
    );
    renderPage();

    expect(await screen.findByText('Organization Admin access required')).toBeInTheDocument();
  });
});
