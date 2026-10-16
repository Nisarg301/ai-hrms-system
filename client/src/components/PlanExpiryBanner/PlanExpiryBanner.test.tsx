import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestStore } from '../../test/makeTestStore';
import { activeSubscription, expiredSubscription } from '../../test/fixtures';
import type { AuthState } from '../../store/auth/authSlice';
import type { AuthUser, UserRoleName } from '../../types/auth';
import type { Subscription } from '../../types/subscription';
import { PlanExpiryBanner } from './PlanExpiryBanner';

function user(role: UserRoleName, subscription: Subscription | null): AuthUser {
  return { id: 'u1', name: 'U', email: 'u@x.com', role, organizationId: 'o1', roleId: null, mustChangePassword: false, permissions: { scope: 'all' }, subscription };
}

function renderBanner(authUser: AuthUser) {
  const auth: AuthState = { user: authUser, status: 'authenticated', bootstrapped: true, error: null, resetToken: null };
  return render(
    <Provider store={makeTestStore({ auth })}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<PlanExpiryBanner />} />
          <Route path="/billing" element={<div>Billing Page</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

beforeEach(() => sessionStorage.clear());

describe('PlanExpiryBanner', () => {
  it('warns an Org Admin in the last 7 days and links to Billing', async () => {
    renderBanner(user('ORG_ADMIN', activeSubscription('professional', 3)));
    expect(screen.getByText(/your professional plan expires on .* \(3 days left\)/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Renew now' }));
    expect(await screen.findByText('Billing Page')).toBeInTheDocument();
  });

  it('says "1 day" on the last day', () => {
    renderBanner(user('ORG_ADMIN', activeSubscription('basic', 0.5)));
    expect(screen.getByText(/\(1 day left\)/)).toBeInTheDocument();
  });

  it('stays hidden while more than 7 days remain', () => {
    const { container } = renderBanner(user('ORG_ADMIN', activeSubscription('basic', 10)));
    expect(container).toBeEmptyDOMElement();
  });

  it('is never shown to an Org User or for an inactive plan', () => {
    const asUser = renderBanner(user('ORG_USER', activeSubscription('basic', 3)));
    expect(asUser.container).toBeEmptyDOMElement();
    asUser.unmount();
    const expired = renderBanner(user('ORG_ADMIN', expiredSubscription()));
    expect(expired.container).toBeEmptyDOMElement();
  });

  it('stays dismissed for the session, but only for that billing period', async () => {
    const subscription = activeSubscription('basic', 3);
    const first = renderBanner(user('ORG_ADMIN', subscription));
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByText(/expires on/)).not.toBeInTheDocument();
    first.unmount();

    const again = renderBanner(user('ORG_ADMIN', subscription));
    expect(again.container).toBeEmptyDOMElement();
    again.unmount();

    // A renewal brings a new expiry date, so the reminder can show again.
    renderBanner(user('ORG_ADMIN', { ...subscription, expiryDate: new Date(Date.now() + 2 * 86_400_000).toISOString() }));
    expect(screen.getByText(/expires on/)).toBeInTheDocument();
  });
});
