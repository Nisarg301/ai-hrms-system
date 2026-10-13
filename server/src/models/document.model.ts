import { Schema, model, Document as MongooseDocument, Types } from 'mongoose';

export const DOCUMENT_STATUSES = ['active', 'archived'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export interface IDocumentFile {
    id: Types.ObjectId;
    originalName: string;
    mimeType: string;
    size: number;
}

// Named IDocumentRecord (not IDocument) because Mongoose's own `Document` type is
// imported here as MongooseDocument; keeping the names distinct avoids confusion.
export interface IDocumentRecord extends MongooseDocument {
    organizationId: Types.ObjectId;
    title: string;
    description: string;
    category: string;
    status: DocumentStatus;
    file: IDocumentFile | null;
    isDeleted: boolean;
    deletedAt: Date | null;
    deletedBy: Types.ObjectId | null;
    createdBy: Types.ObjectId | null;
    updatedBy: Types.ObjectId | null;
    createdAt: Date;
    updatedAt: Date;
}

const documentSchema = new Schema<IDocumentRecord>(
    {
        organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
        title: { type: String, required: true, trim: true },
        description: { type: String, required: true, trim: true },
        category: { type: String, required: true, trim: true },
        status: { type: String, enum: DOCUMENT_STATUSES, default: 'active' },
        file: {
            id: { type: Schema.Types.ObjectId, default: null },
            originalName: { type: String, default: null },
            mimeType: { type: String, default: null },
            size: { type: Number, default: 0 },
        },
        isDeleted: { type: Boolean, default: false },
        deletedAt: { type: Date, default: null },
        deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { timestamps: true }
);

// No uniqueness index: two documents in the same organization may share a title.

export const DocumentModel = model<IDocumentRecord>('Document', documentSchema);
