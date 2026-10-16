import { Schema, model, Document, Types } from 'mongoose';

/** A per-organization running number (e.g. key "expense-2026" for EXP-2026-NNNN). */
export interface ICounter extends Document {
    organizationId: Types.ObjectId;
    key: string;
    value: number;
}

const counterSchema = new Schema<ICounter>({
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    key: { type: String, required: true },
    value: { type: Number, default: 0 },
});

counterSchema.index({ organizationId: 1, key: 1 }, { unique: true });

export const CounterModel = model<ICounter>('Counter', counterSchema);
