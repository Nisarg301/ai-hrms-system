import crypto from 'crypto';
import Razorpay from 'razorpay';
import { env } from '../config/env';
import { ApiError } from '../utils/apiResponse';

let client: Razorpay | null = null;

function credentials(): { keyId: string; secret: string } {
  if (!env.RAZOR_PAY_API_KEY || !env.RAZOR_PAY_SECRET) {
    throw new ApiError(503, 'Payments are not configured');
  }
  return { keyId: env.RAZOR_PAY_API_KEY, secret: env.RAZOR_PAY_SECRET };
}

// Wrapped in one object so tests can jest.spyOn(razorpayService, 'createOrder')
// and never call Razorpay over the network.
export const razorpayService = {
  keyId(): string {
    return credentials().keyId;
  },

  async createOrder(input: { amount: number; currency: string; receipt: string; notes: Record<string, string> }) {
    const { keyId, secret } = credentials();
    client ??= new Razorpay({ key_id: keyId, key_secret: secret });
    const order = await client.orders.create(input);
    return { id: order.id, amount: Number(order.amount), currency: order.currency };
  },

  /** Razorpay's checkout signature: HMAC_SHA256(order_id|payment_id, secret), compared in constant time. */
  verifySignature(orderId: string, paymentId: string, signature: string): boolean {
    const expected = crypto.createHmac('sha256', credentials().secret).update(`${orderId}|${paymentId}`).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },
};
