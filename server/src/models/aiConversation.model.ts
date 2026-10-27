import { Schema, model, Document, Types } from 'mongoose';
import { env } from '../config/env';
import type { AiResult, ApiCall, ConfirmCard, ToolDraft } from '../ai/types';

export const AI_ACTION_STATUSES = ['pending', 'confirmed', 'cancelled', 'expired'] as const;
export type AiActionStatus = (typeof AI_ACTION_STATUSES)[number];

export interface IAiMessage {
  role: 'user' | 'assistant';
  /** What the model sees in later turns: plain text, never secrets. */
  content: string;
  /** What the chat shows for an assistant answer. */
  result: AiResult | null;
  /** Set when the answer is a confirm card. */
  actionId: Types.ObjectId | null;
  createdAt: Date;
}

export interface IAiPendingAction {
  _id: Types.ObjectId;
  tool: string;
  args: Record<string, unknown>;
  /** The API calls Confirm runs (or ran, once confirmed). */
  calls: ApiCall[];
  card: ConfirmCard;
  meta: Record<string, unknown>;
  status: AiActionStatus;
  expiresAt: Date;
  resultText: string | null;
}

export interface IAiConversation extends Document {
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  module: string;
  messages: IAiMessage[];
  pendingActions: Types.DocumentArray<IAiPendingAction & Document>;
  /** A write tool waiting for more details ("I still need the email address"). */
  draft: ToolDraft | null;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IAiMessage>(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, default: '' },
    result: { type: Schema.Types.Mixed, default: null },
    actionId: { type: Schema.Types.ObjectId, default: null },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

const pendingActionSchema = new Schema<IAiPendingAction>({
  tool: { type: String, required: true },
  args: { type: Schema.Types.Mixed, default: {} },
  calls: { type: Schema.Types.Mixed, default: [] },
  card: { type: Schema.Types.Mixed, required: true },
  meta: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, enum: AI_ACTION_STATUSES, default: 'pending' },
  expiresAt: { type: Date, required: true },
  resultText: { type: String, default: null },
});

const aiConversationSchema = new Schema<IAiConversation>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    module: { type: String, required: true },
    messages: { type: [messageSchema], default: [] },
    pendingActions: { type: [pendingActionSchema], default: [] },
    draft: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

aiConversationSchema.index({ organizationId: 1, userId: 1, module: 1, updatedAt: -1 });
// Chat history is kept for AI_HISTORY_DAYS after the last message. Mongoose does not change an
// existing TTL index: after changing the setting, run collMod on `updatedAt_1`.
aiConversationSchema.index({ updatedAt: 1 }, { expireAfterSeconds: env.AI_HISTORY_DAYS * 24 * 60 * 60 });

export const AiConversationModel = model<IAiConversation>('AiConversation', aiConversationSchema);
