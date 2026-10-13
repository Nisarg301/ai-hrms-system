import { Schema, model, Document, Types } from 'mongoose';
import { PLAN_TYPES, PlanType } from '../constants/modules';
import { BILLING_CYCLES, BillingCycle, PLAN_CURRENCY } from '../constants/plans';

export interface IOrganization extends Document {
  name: string;
  isActive: boolean;
  planType: PlanType | null;
  billingCycle: BillingCycle | null;
  /** Paise paid for the current billing period. */
  planAmount: number;
  planCurrency: string;
  planStartDate: Date | null;
  expiryDate: Date | null;
  planActive: boolean;
  expiryReminderSentAt: Date | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const organizationSchema = new Schema<IOrganization>(
  {
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    // Subscription. Orgs created before this existed have none of these fields,
    // which reads exactly like "never purchased".
    planType: { type: String, enum: [...PLAN_TYPES, null], default: null },
    billingCycle: { type: String, enum: [...BILLING_CYCLES, null], default: null },
    planAmount: { type: Number, default: 0 },
    planCurrency: { type: String, default: PLAN_CURRENCY },
    planStartDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
    planActive: { type: Boolean, default: false },
    expiryReminderSentAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

export const OrganizationModel = model<IOrganization>('Organization', organizationSchema);
