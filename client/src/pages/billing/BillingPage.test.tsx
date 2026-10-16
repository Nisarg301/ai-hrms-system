import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import { activeSubscription, expiredSubscription, NO_PLAN } from '../../test/fixtures';
import { PLANS } from '../../test/planCatalogData';
import type { AuthState } from '../../store/auth/authSlice';
import type { AuthUser } from '../../types/auth';
import type { RazorpayFailureResponse, RazorpayOptions } from '../../types/razorpay';
import type { Subscription } from '../../types/subscription';
import BillingPage from './BillingPage';

/** Stand-in for Razorpay Checkout: records its options so a test can play the user's part. */
class FakeRazorpay {
  static instances: FakeRazorpay[] = [];
  options: RazorpayOptions;
  onFailed: ((r: RazorpayFailureResponse) => void) | null = null;
  open = vi.fn();
  constructor(options: RazorpayOptions) {
    this.options = options;
    FakeRazorpay.instances.push(this);
  }
  on(_event: 'payment.failed', callback: (r: RazorpayFailureResponse) => void) {
    this.onFailed = callback;
  }
  static get last() {
    return FakeRazorpay.instances[FakeRazorpay.instances.length - 1];
  }
}

beforeEach(() => {
  FakeRazorpay.instances = [];
  window.Razorpay = FakeRazorpay as unknown as typeof window.Razorpay;
});
afterEach(() => {
  delete window.Razorpay;
});

function admin(subscription: Subscription): AuthUser {
  return { id: 'u1', name: 'Ann Admin', email: 'ann@acme.com', role: 'ORG_ADMIN', organizationId: 'o1', roleId: null, mustChangePassword: false, permissions: { scope: 'all' }, subscription };
}

function renderBilling(subscription: Subscription) {
  const auth: AuthState = { user: admin(subscription), status: 'authenticated', bootstrapped: true, error: null, resetToken: null };
  const store = makeTestStore({ auth });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/billing']}>
        <Routes>
          <Route path="/billing" element={<BillingPage />} />
          <Route path="/home" element={<div>Home Page</div>} />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return store;
}

/** Catalog + order creation; records what the page sent. */
function mockBackend() {
  const sent: { order?: unknown; verify?: unknown } = {};
  server.use(
    http.get(`${API_BASE_URL}/plans`, () => HttpResponse.json({ success: true, data: PLANS })),
    http.post(`${API_BASE_URL}/subscription/orders`, async ({ request }) => {
      sent.order = await request.json();
      const { planType, billingCycle } = sent.order as { planType: 'basic' | 'professional'; billingCycle: 'monthly' | 'quarterly' | 'yearly' };
      const amount = PLANS.find((p) => p.type === planType)!.prices[billingCycle];
      return HttpResponse.json({ success: true, data: { orderId: 'order_1', amount, currency: 'INR', keyId: 'rzp_test_key', planType, billingCycle } }, { status: 201 });
    }),
    http.post(`${API_BASE_URL}/subscription/verify`, async ({ request }) => {
      sent.verify = await request.json();
      return HttpResponse.json({ success: true, data: { subscription: activeSubscription('basic', 90) } });
    }),
    http.get(`${API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: { user: admin(activeSubscription('basic', 90)) } })
    )
  );
  return sent;
}

const PAID = { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig_1' };

describe('BillingPage', () => {
  it('asks an organization without a plan to choose one', async () => {
    mockBackend();
    renderBilling(NO_PLAN);
    expect(await screen.findByText(/needs an active plan to continue/i)).toBeInTheDocument();
    expect(await screen.findByText('₹300')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /back to home/i })).not.toBeInTheDocument();
  });

  it('says when the plan expired', async () => {
    mockBackend();
    renderBilling(expiredSubscription('professional'));
    expect(await screen.findByText(/your professional plan expired on/i)).toBeInTheDocument();
  });

  it('pays for a plan through Razorpay and lands on Home', async () => {
    const sent = mockBackend();
    const store = renderBilling(NO_PLAN);

    await userEvent.click(await screen.findByText('Quarterly'));
    await userEvent.click(screen.getByRole('button', { name: 'Choose Basic' }));

    await waitFor(() => expect(FakeRazorpay.last?.open).toHaveBeenCalled());
    // Only plan and cycle go to the server; the price comes back from it.
    expect(sent.order).toEqual({ planType: 'basic', billingCycle: 'quarterly' });
    expect(FakeRazorpay.last.options).toMatchObject({
      key: 'rzp_test_key',
      order_id: 'order_1',
      amount: 90000,
      currency: 'INR',
      prefill: { name: 'Ann Admin', email: 'ann@acme.com' },
    });

    act(() => FakeRazorpay.last.options.handler(PAID));

    expect(await screen.findByText('Home Page')).toBeInTheDocument();
    expect(sent.verify).toEqual(PAID);
    expect(store.getState().auth.user?.subscription).toMatchObject({ planType: 'basic', active: true });
    expect(store.getState().auth.status).toBe('authenticated');
  });

  it('shows why a payment failed and lets the admin try again', async () => {
    mockBackend();
    renderBilling(NO_PLAN);
    await userEvent.click(await screen.findByRole('button', { name: 'Choose Professional' }));
    await waitFor(() => expect(FakeRazorpay.last?.open).toHaveBeenCalled());

    act(() => FakeRazorpay.last.onFailed!({ error: { description: 'Your card was declined.' } }));

    expect(await screen.findByText('Your card was declined.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose Professional' })).toBeEnabled();
  });

  it('re-enables the buttons when the payment window is closed', async () => {
    mockBackend();
    renderBilling(NO_PLAN);
    await userEvent.click(await screen.findByRole('button', { name: 'Choose Basic' }));
    await waitFor(() => expect(FakeRazorpay.last?.open).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Choose Professional' })).toBeDisabled();

    act(() => FakeRazorpay.last.options.modal!.ondismiss!());

    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose Professional' })).toBeEnabled());
  });

  it('shows the payment id when a paid order cannot be verified', async () => {
    mockBackend();
    server.use(http.post(`${API_BASE_URL}/subscription/verify`, () => HttpResponse.json({ success: false, error: { message: 'Payment verification failed' } }, { status: 400 })));
    renderBilling(NO_PLAN);
    await userEvent.click(await screen.findByRole('button', { name: 'Choose Basic' }));
    await waitFor(() => expect(FakeRazorpay.last?.open).toHaveBeenCalled());

    act(() => FakeRazorpay.last.options.handler(PAID));

    expect(await screen.findByText(/could not be verified.*payment ID pay_1/i)).toBeInTheDocument();
  });

  it('warns before a downgrade, and cancelling creates no order', async () => {
    const sent = mockBackend();
    renderBilling(activeSubscription('professional'));
    expect(await screen.findByText(/you're on the professional plan/i)).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Choose Basic' }));
    expect(await screen.findByText(/remaining Professional time is not refunded/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(sent.order).toBeUndefined();

    await userEvent.click(screen.getByRole('button', { name: 'Choose Basic' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(sent.order).toEqual({ planType: 'basic', billingCycle: 'monthly' }));
  });

  it('offers a way back for an admin whose plan is active', async () => {
    mockBackend();
    renderBilling(activeSubscription('basic'));
    await userEvent.click(await screen.findByRole('button', { name: /back to home/i }));
    expect(await screen.findByText('Home Page')).toBeInTheDocument();
  });

  it('shows an error with a retry when the plans cannot be loaded', async () => {
    server.use(http.get(`${API_BASE_URL}/plans`, () => HttpResponse.json({ success: false, error: { message: 'Service unavailable' } }, { status: 503 })));
    renderBilling(NO_PLAN);
    expect(await screen.findByText('Service unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
