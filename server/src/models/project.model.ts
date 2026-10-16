import { Schema, model, Document as MongooseDocument, Types } from 'mongoose';

export const PROJECT_STATUSES = ['planning', 'active', 'completed', 'on-hold'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

// Named IProjectRecord (not IProject) because Mongoose's own `Document` type is
// imported here as MongooseDocument; keeping the names distinct avoids confusion.
export interface IProjectRecord extends MongooseDocument {
  organizationId: Types.ObjectId;
  name: string;
  description: string;
  deadline: Date;
  status: ProjectStatus;
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const projectSchema = new Schema<IProjectRecord>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    deadline: { type: Date, required: true },
    status: { type: String, enum: PROJECT_STATUSES, default: 'planning' },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// No uniqueness index: two projects in the same organization may share a name.

export const ProjectModel = model<IProjectRecord>('Project', projectSchema);
