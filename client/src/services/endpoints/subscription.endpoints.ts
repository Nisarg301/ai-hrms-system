import { callApiServices } from '../callApiServices';
import type { BillingCycle, PlanDefinition, PlanType, Subscription } from '../../types/subscription';
import type { RazorpaySuccessResponse } from '../../types/razorpay';

export interface CreatedOrder {
  orderId: string;
  /** Paise, set by the server from its plan catalog. */
  amount: number;
  currency: string;
  /** Public Razorpay key id for Checkout. The secret never leaves the backend. */
  keyId: string;
  planType: PlanType;
  billingCycle: BillingCycle;
}

export function listPlansRequest() {
  return callApiServices<PlanDefinition[]>('/plans', 'get', true);
}

/** Only the plan and cycle: the backend rejects any amount sent by the client. */
export function createOrderRequest(payload: { planType: PlanType; billingCycle: BillingCycle }) {
  return callApiServices<CreatedOrder>('/subscription/orders', 'post', true, payload);
}

export function verifyPaymentRequest(payload: RazorpaySuccessResponse) {
  return callApiServices<{ subscription: Subscription }>('/subscription/verify', 'post', true, payload);
}
