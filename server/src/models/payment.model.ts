import { Schema, model, Document, Types } from 'mongoose';
import { PLAN_TYPES, PlanType } from '../constants/modules';
import { BILLING_CYCLES, BillingCycle } from '../constants/plans';

export const PAYMENT_STATUSES = ['created', 'paid', 'failed'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface IPayment extends Document {
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  planType: PlanType;
  billingCycle: BillingCycle;
  /** Paise, taken from the plan catalog when the order was created. */
  amount: number;
  currency: string;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  razorpaySignature: string | null;
  status: PaymentStatus;
  paidAt: Date | null;
  // Present only so BaseRepository's not-deleted filter matches; payments are never deleted.
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    planType: { type: String, enum: PLAN_TYPES, required: true },
    billingCycle: { type: String, enum: BILLING_CYCLES, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, default: null },
    razorpaySignature: { type: String, default: null },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'created' },
    paidAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const PaymentModel = model<IPayment>('Payment', paymentSchema);
