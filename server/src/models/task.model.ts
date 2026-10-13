import { Schema, model, Document as MongooseDocument, Types } from 'mongoose';

export const TASK_STATUSES = ['todo', 'in-progress', 'done', 'blocked'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

// Named ITaskRecord (not ITask) because Mongoose's own `Document` type is
// imported here as MongooseDocument; keeping the names distinct avoids confusion.
export interface ITaskRecord extends MongooseDocument {
  organizationId: Types.ObjectId;
  projectId?: Types.ObjectId | null;
  userId: Types.Array<Types.ObjectId>;
  title: string;
  description: string;
  dueDate: string;
  status: TaskStatus;
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const taskSchema = new Schema<ITaskRecord>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    userId: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    // Stored as a plain YYYY-MM-DD string, not a Date -- a due date is a calendar
    // concept, not a point-in-time instant. See the design spec's timezone note.
    dueDate: { type: String, required: true, trim: true },
    status: { type: String, enum: TASK_STATUSES, default: 'todo' },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// No uniqueness index: two tasks in the same organization may share a title.

export const TaskModel = model<ITaskRecord>('Task', taskSchema);
