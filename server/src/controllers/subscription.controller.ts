import { Request, Response } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler';
import { PlanType } from '../constants/modules';
import { BillingCycle, PLANS, PLAN_CURRENCY } from '../constants/plans';
import { organizationRepository } from '../repositories/organization.repository';
import { paymentRepository } from '../repositories/payment.repository';
import { PaymentModel } from '../models/payment.model';
import { razorpayService } from '../services/razorpay.service';
import { activateFromPayment, subscriptionState } from '../services/subscription.service';
import { successResponse, ApiError } from '../utils/apiResponse';

export const getSubscription = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const org = await organizationRepository.findById(organizationId);
  if (!org) {
    throw new ApiError(404, 'Organization not found');
  }
  const payments = await PaymentModel.find({ organizationId }).sort({ createdAt: -1 }).limit(10);
  res.status(200).json(
    successResponse({
      ...subscriptionState(org),
      planAmount: org.planAmount,
      planCurrency: org.planCurrency,
      planStartDate: org.planStartDate,
      payments: payments.map((p) => ({
        id: p._id.toString(),
        planType: p.planType,
        billingCycle: p.billingCycle,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
      })),
    })
  );
});

export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  const { planType, billingCycle } = req.body as { planType: PlanType; billingCycle: BillingCycle };
  const organizationId = req.orgFilter!.organizationId;
  // The price is always the server-side catalog price, never anything the client sent.
  const amount = PLANS[planType].prices[billingCycle];
  const order = await razorpayService.createOrder({
    amount,
    currency: PLAN_CURRENCY,
    // Razorpay caps receipt at 40 characters.
    receipt: `org_${organizationId.toString().slice(-8)}_${Date.now()}`,
    notes: { organizationId: organizationId.toString(), planType, billingCycle },
  });
  await paymentRepository.create(
    {
      organizationId,
      userId: req.user!.id as never,
      planType,
      billingCycle,
      amount,
      currency: PLAN_CURRENCY,
      razorpayOrderId: order.id,
      status: 'created',
    },
    req.user!.id
  );
  res.status(201).json(
    successResponse({ orderId: order.id, amount, currency: PLAN_CURRENCY, keyId: razorpayService.keyId(), planType, billingCycle })
  );
});

export const verifyPayment = asyncHandler(async (req: Request, res: Response) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  // Scoped to the caller's organization: another org's order id is simply "not found".
  const payment = await paymentRepository.findOne({ razorpayOrderId: razorpay_order_id, organizationId: req.orgFilter!.organizationId });
  if (!payment) {
    throw new ApiError(404, 'Order not found');
  }
  if (!razorpayService.verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    throw new ApiError(400, 'Payment verification failed');
  }
  const subscription = await activateFromPayment(payment, razorpay_payment_id, razorpay_signature);
  res.status(200).json(successResponse({ subscription }));
});
