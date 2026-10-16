import { Schema, model, Document as MongooseDocument, Types } from 'mongoose';

export const DEPARTMENT_STATUSES = ['active', 'inactive'] as const;
export type DepartmentStatus = (typeof DEPARTMENT_STATUSES)[number];

// Named IDocumentRecord (not IDocument) because Mongoose's own `Document` type is
// imported here as MongooseDocument; keeping the names distinct avoids confusion.
export interface IDepartmentRecord extends MongooseDocument {
    organizationId: Types.ObjectId;
    title: string;
    description: string;
    status: DepartmentStatus;
    isDeleted: boolean;
    deletedAt: Date | null;
    deletedBy: Types.ObjectId | null;
    createdBy: Types.ObjectId | null;
    updatedBy: Types.ObjectId | null;
    createdAt: Date;
    updatedAt: Date;
}

const departmentSchema = new Schema<IDepartmentRecord>(
    {
        organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
        title: { type: String, required: true, trim: true },
        description: { type: String, required: true, trim: true },
        status: { type: String, enum: DEPARTMENT_STATUSES, default: 'active' },
        isDeleted: { type: Boolean, default: false },
        deletedAt: { type: Date, default: null },
        deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { timestamps: true }
);

// No uniqueness index: two documents in the same organization may share a title.

export const DepartmentModel = model<IDepartmentRecord>('Department', departmentSchema);
