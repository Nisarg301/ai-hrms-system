import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { PLANS } from '../../test/planCatalogData';
import PlansPage from './PlansPage';

describe('PlansPage (Super Admin)', () => {
  it('shows the real plan catalog, read-only', async () => {
    server.use(http.get(`${API_BASE_URL}/plans`, () => HttpResponse.json({ success: true, data: PLANS })));
    render(<PlansPage />);
    expect(await screen.findByText('₹300')).toBeInTheDocument();
    expect(screen.getByText('₹600')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /choose|renew/i })).not.toBeInTheDocument();
  });

  it('shows a load error', async () => {
    server.use(http.get(`${API_BASE_URL}/plans`, () => HttpResponse.json({ success: false, error: { message: 'Service unavailable' } }, { status: 503 })));
    render(<PlansPage />);
    expect(await screen.findByText('Service unavailable')).toBeInTheDocument();
  });
});
