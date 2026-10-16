import { Types } from 'mongoose';
import { ModuleName, PLAN_FEATURES, PLAN_MODULES, PlanFeature, PlanType } from '../constants/modules';
import { BillingCycle, CYCLE_MONTHS } from '../constants/plans';
import { IOrganization } from '../models/organization.model';
import { IPayment, PaymentModel } from '../models/payment.model';
import { organizationRepository } from '../repositories/organization.repository';

/** Shown to an ORG_USER whose organization has no active plan (login is refused). */
export const ORG_PLAN_EXPIRED_MESSAGE = "Your organization's plan has expired. Please contact your organization admin.";

export interface SubscriptionState {
  planType: PlanType | null;
  billingCycle: BillingCycle | null;
  expiryDate: Date | null;
  active: boolean;
  modules: ModuleName[];
  /** Plan features (Expenses, Onboarding, Performance): see PLAN_FEATURES. */
  features: PlanFeature[];
}

type PlanFields = Pick<IOrganization, 'planType' | 'billingCycle' | 'expiryDate' | 'planActive'>;

/** What's enforced is the date, not just the stored flag, so no job has to run on time. */
export function isPlanActive(org: PlanFields, now: Date = new Date()): boolean {
  return Boolean(org.planActive && org.planType && org.expiryDate && org.expiryDate.getTime() > now.getTime());
}

export function subscriptionState(org: PlanFields, now: Date = new Date()): SubscriptionState {
  const active = isPlanActive(org, now);
  return {
    planType: org.planType ?? null,
    billingCycle: org.billingCycle ?? null,
    expiryDate: org.expiryDate ?? null,
    active,
    modules: active && org.planType ? [...PLAN_MODULES[org.planType]] : [],
    features: active && org.planType ? [...PLAN_FEATURES[org.planType]] : [],
  };
}

/** Calendar-month add in UTC, clamping the day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/**
 * Renewing the same, still-active plan stacks onto the current expiry so no paid
 * time is lost. Any plan change (upgrade or downgrade) or a lapsed plan starts now.
 */
export function computeNewTerm(
  org: PlanFields & Pick<IOrganization, 'planStartDate'>,
  planType: PlanType,
  billingCycle: BillingCycle,
  now: Date = new Date()
): { planStartDate: Date; expiryDate: Date } {
  const renewal = isPlanActive(org, now) && org.planType === planType;
  const base = renewal ? org.expiryDate! : now;
  return {
    planStartDate: renewal && org.planStartDate ? org.planStartDate : now,
    expiryDate: addMonths(base, CYCLE_MONTHS[billingCycle]),
  };
}

/** Lazily flips the stored flag once an expired org is noticed. */
export async function markExpiredIfNeeded(org: IOrganization, now: Date = new Date()): Promise<void> {
  if (org.planActive && !isPlanActive(org, now)) {
    await organizationRepository.updateById(org._id as Types.ObjectId, { planActive: false });
  }
}

export async function getSubscriptionForOrg(organizationId: string | Types.ObjectId): Promise<SubscriptionState | null> {
  const org = await organizationRepository.findById(organizationId);
  return org ? subscriptionState(org) : null;
}

/**
 * Applies a payment whose signature has already been verified. The atomic
 * created -> paid claim makes a replayed or concurrent verify a no-op, so one
 * payment can never extend a plan twice.
 */
export async function activateFromPayment(
  payment: IPayment,
  razorpayPaymentId: string,
  razorpaySignature: string,
  now: Date = new Date()
): Promise<SubscriptionState> {
  const claimed = await PaymentModel.findOneAndUpdate(
    { _id: payment._id, status: 'created' },
    { status: 'paid', razorpayPaymentId, razorpaySignature, paidAt: now },
    { returnDocument: 'after' }
  );
  const org = await organizationRepository.findById(payment.organizationId);
  if (!org) {
    throw new Error(`Organization ${payment.organizationId.toString()} not found for payment ${String(payment._id)}`);
  }
  if (!claimed) {
    return subscriptionState(org, now);
  }
  const term = computeNewTerm(org, payment.planType, payment.billingCycle, now);
  const updated = await organizationRepository.updateById(org._id as Types.ObjectId, {
    planType: payment.planType,
    billingCycle: payment.billingCycle,
    planAmount: payment.amount,
    planCurrency: payment.currency,
    planStartDate: term.planStartDate,
    expiryDate: term.expiryDate,
    planActive: true,
    // A new billing period gets its own expiry reminder.
    expiryReminderSentAt: null,
  });
  return subscriptionState(updated!, now);
}
