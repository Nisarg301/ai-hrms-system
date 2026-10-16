import { Schema, model, Document, Types } from 'mongoose';

/** The values a praise can recognise (spec default 17). */
export const PRAISE_BADGES = ['teamwork', 'above_and_beyond', 'customer_first', 'innovation', 'leadership', 'thank_you'] as const;
export type PraiseBadge = (typeof PRAISE_BADGES)[number];
export const MAX_PRAISE_RECIPIENTS = 5;

export interface IPraise {
  recipientIds: Types.ObjectId[];
  badge: PraiseBadge;
}

export interface IPost extends Document {
  organizationId: Types.ObjectId;
  authorId: Types.ObjectId;
  body: string;
  /** One entry per member who likes the post; changed only with $addToSet / $pull. */
  likedBy: Types.ObjectId[];
  /** Live (not deleted) comments, kept in step with $inc as comments come and go. */
  commentCount: number;
  /** Set when the post praises colleagues; otherwise null. */
  praise: IPraise | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const postSchema = new Schema<IPost>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true },
    likedBy: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    commentCount: { type: Number, default: 0 },
    praise: {
      type: new Schema<IPraise>(
        {
          recipientIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], required: true },
          badge: { type: String, enum: PRAISE_BADGES, required: true },
        },
        { _id: false }
      ),
      default: null,
    },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// The feed: newest first by _id within an organization.
postSchema.index({ organizationId: 1, isDeleted: 1, _id: -1 });
// Praise someone has received (profile panel).
postSchema.index({ organizationId: 1, 'praise.recipientIds': 1, isDeleted: 1 });

export const PostModel = model<IPost>('Post', postSchema);
