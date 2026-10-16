import { Schema, model, Document, Types } from 'mongoose';

export interface IAnnouncement extends Document {
    organizationId: Types.ObjectId;
    title: string;
    body: string;
    /** Pinned announcements stay at the top. */
    pinned: boolean;
    /** YYYY-MM-DD: shown up to and including this day. null = no expiry. */
    expiresOn: string | null;
    isDeleted: boolean;
    deletedAt: Date | null;
    deletedBy: Types.ObjectId | null;
    createdBy: Types.ObjectId | null;
    updatedBy: Types.ObjectId | null;
    createdAt: Date;
    updatedAt: Date;
}

const announcementSchema = new Schema<IAnnouncement>(
    {
        organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
        title: { type: String, required: true, trim: true },
        body: { type: String, required: true, trim: true },
        pinned: { type: Boolean, default: false },
        expiresOn: { type: String, default: null },
        isDeleted: { type: Boolean, default: false },
        deletedAt: { type: Date, default: null },
        deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { timestamps: true }
);

export const AnnouncementModel = model<IAnnouncement>('Announcement', announcementSchema);
