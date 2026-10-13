import { Schema, model, Document, Types } from 'mongoose';

export const CLAIM_STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'paid'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/**
 * An expense claim: a title and 1–20 items (ExpenseItem), moving draft →
 * submitted → approved/rejected → paid. State changes are atomic updates from
 * the expected status, like leave.
 */
export interface IExpenseClaim extends Document {
    organizationId: Types.ObjectId;
    employeeId: Types.ObjectId;
    title: string;
    /** EXP-YYYY-NNNN, given on first submit; null while a never-submitted draft. */
    number: string | null;
    status: ClaimStatus;
    /** Sum of the live items, in paise. */
    totalPaise: number;
    itemCount: number;
    submittedAt: Date | null;
    decidedBy: Types.ObjectId | null;
    decidedAt: Date | null;
    decisionNote: string;
    paidBy: Types.ObjectId | null;
    paidAt: Date | null;
    /** YYYY-MM-DD the money was sent. */
    paidOn: string | null;
    paymentReference: string;
    /** The claim this draft was copied from, if any. */
    copiedFrom: Types.ObjectId | null;
    isDeleted: boolean;
    deletedAt: Date | null;
    deletedBy: Types.ObjectId | null;
    createdBy: Types.ObjectId | null;
    updatedBy: Types.ObjectId | null;
    createdAt: Date;
    updatedAt: Date;
}

const expenseClaimSchema = new Schema<IExpenseClaim>(
    {
        organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
        employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        title: { type: String, required: true, trim: true },
        number: { type: String, default: null },
        status: { type: String, enum: CLAIM_STATUSES, default: 'draft' },
        totalPaise: { type: Number, default: 0 },
        itemCount: { type: Number, default: 0 },
        submittedAt: { type: Date, default: null },
        decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        decidedAt: { type: Date, default: null },
        decisionNote: { type: String, default: '' },
        paidBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        paidAt: { type: Date, default: null },
        paidOn: { type: String, default: null },
        paymentReference: { type: String, default: '' },
        copiedFrom: { type: Schema.Types.ObjectId, ref: 'ExpenseClaim', default: null },
        isDeleted: { type: Boolean, default: false },
        deletedAt: { type: Date, default: null },
        deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { timestamps: true }
);

expenseClaimSchema.index({ organizationId: 1, status: 1, submittedAt: 1 });
expenseClaimSchema.index({ organizationId: 1, employeeId: 1, createdAt: -1 });

export const ExpenseClaimModel = model<IExpenseClaim>('ExpenseClaim', expenseClaimSchema);
