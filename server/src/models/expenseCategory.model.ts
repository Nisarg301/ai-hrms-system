import { Schema, model, Document, Types } from 'mongoose';

export interface IExpenseCategory extends Document {
    organizationId: Types.ObjectId;
    name: string;
    /** Lower-cased name, for the per-organization uniqueness index. */
    nameKey: string;
    /** Per-expense limit in paise; null = no limit. Over it is allowed but flagged (E3). */
    limitPaise: number | null;
    /** A receipt is required for an expense above this (paise); 0 = always. */
    receiptRequiredAbovePaise: number;
    isActive: boolean;
    isDeleted: boolean;
    deletedAt: Date | null;
    deletedBy: Types.ObjectId | null;
    createdBy: Types.ObjectId | null;
    updatedBy: Types.ObjectId | null;
    createdAt: Date;
    updatedAt: Date;
}

/** ₹500, the default receipt threshold (spec default 3). */
export const DEFAULT_RECEIPT_THRESHOLD_PAISE = 50000;

const expenseCategorySchema = new Schema<IExpenseCategory>(
    {
        organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
        name: { type: String, required: true, trim: true },
        nameKey: { type: String, required: true },
        limitPaise: { type: Number, default: null },
        receiptRequiredAbovePaise: { type: Number, default: DEFAULT_RECEIPT_THRESHOLD_PAISE },
        isActive: { type: Boolean, default: true },
        isDeleted: { type: Boolean, default: false },
        deletedAt: { type: Date, default: null },
        deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { timestamps: true }
);

expenseCategorySchema.pre('validate', function setKey() {
    this.nameKey = this.name.trim().toLowerCase();
});
expenseCategorySchema.index({ organizationId: 1, nameKey: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

export const ExpenseCategoryModel = model<IExpenseCategory>('ExpenseCategory', expenseCategorySchema);
