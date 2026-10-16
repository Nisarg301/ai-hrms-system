import { Schema, model, Document, Types } from 'mongoose';

export interface IReceipt {
    fileId: Types.ObjectId;
    originalName: string;
    mimeType: string;
    size: number;
}

/** One expense inside a claim. */
export interface IExpenseItem extends Document {
    claimId: Types.ObjectId;
    organizationId: Types.ObjectId;
    /** YYYY-MM-DD the money was spent. */
    date: string;
    categoryId: Types.ObjectId;
    amountPaise: number;
    merchant: string;
    note: string;
    receipts: IReceipt[];
    /** Over its category's limit when the claim was submitted (E3: allowed, flagged). */
    overLimit: boolean;
    isDeleted: boolean;
    deletedAt: Date | null;
    deletedBy: Types.ObjectId | null;
    createdBy: Types.ObjectId | null;
    updatedBy: Types.ObjectId | null;
    createdAt: Date;
    updatedAt: Date;
}

const receiptSchema = new Schema<IReceipt>(
    {
        fileId: { type: Schema.Types.ObjectId, required: true },
        originalName: { type: String, required: true },
        mimeType: { type: String, required: true },
        size: { type: Number, required: true },
    },
    { _id: false }
);

const expenseItemSchema = new Schema<IExpenseItem>(
    {
        claimId: { type: Schema.Types.ObjectId, ref: 'ExpenseClaim', required: true },
        organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
        date: { type: String, required: true },
        categoryId: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory', required: true },
        amountPaise: { type: Number, required: true },
        merchant: { type: String, required: true, trim: true },
        note: { type: String, default: '', trim: true },
        receipts: { type: [receiptSchema], default: [] },
        overLimit: { type: Boolean, default: false },
        isDeleted: { type: Boolean, default: false },
        deletedAt: { type: Date, default: null },
        deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { timestamps: true }
);

expenseItemSchema.index({ claimId: 1, isDeleted: 1, date: 1 });
expenseItemSchema.index({ organizationId: 1, categoryId: 1 });

export const ExpenseItemModel = model<IExpenseItem>('ExpenseItem', expenseItemSchema);
