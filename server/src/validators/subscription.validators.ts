import { z } from 'zod';
import { PLAN_TYPES } from '../constants/modules';
import { BILLING_CYCLES } from '../constants/plans';

// Only the plan and cycle. The price comes from the server-side catalog, and
// .strict() turns a client-sent amount into a 400 rather than silently ignoring it.
export const createOrderSchema = z
  .object({
    planType: z.enum(PLAN_TYPES),
    billingCycle: z.enum(BILLING_CYCLES),
  })
  .strict();

// Field names are exactly what Razorpay Checkout hands to its success handler.
export const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().trim().min(1),
  razorpay_payment_id: z.string().trim().min(1),
  razorpay_signature: z.string().trim().min(1),
});
