import { Schema, model, Document, Types } from 'mongoose';

export interface IHoliday extends Document {
  organizationId: Types.ObjectId;
  name: string;
  /** YYYY-MM-DD. */
  date: string;
  description: string;
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const holidaySchema = new Schema<IHoliday>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    date: { type: String, required: true },
    description: { type: String, trim: true, default: '' },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// One holiday per date per organization; a deleted one frees the date again.
holidaySchema.index({ organizationId: 1, date: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

export const HolidayModel = model<IHoliday>('Holiday', holidaySchema);
