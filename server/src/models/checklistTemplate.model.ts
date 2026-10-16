import { Schema, model, Document, Types } from 'mongoose';

export const LIFECYCLE_KINDS = ['onboarding', 'offboarding'] as const;
export type LifecycleKind = (typeof LIFECYCLE_KINDS)[number];

/** Who does a task: resolved to a person when a process starts ('admin' = any ORG_ADMIN). */
export const ASSIGNEE_KINDS = ['employee', 'manager', 'buddy', 'admin', 'person'] as const;
export type AssigneeKind = (typeof ASSIGNEE_KINDS)[number];

/** How a task is completed: marked done, a file uploaded, "I've read this", or answers to questions. */
export const CHECKLIST_TASK_TYPES = ['task', 'upload', 'acknowledge', 'form'] as const;
export type ChecklistTaskType = (typeof CHECKLIST_TASK_TYPES)[number];

export interface ITemplateTask {
    /** Stable id within the template, for the editor. */
    key: string;
    title: string;
    instructions: string;
    assignee: { kind: AssigneeKind; userId: Types.ObjectId | null };
    /** Days from the anchor date (joining date or last working day); negative = before it. */
    dueOffsetDays: number;
    type: ChecklistTaskType;
    /** Form questions (type 'form' only). */
    questions: string[];
    /** An app path (/home?tab=welcome) or an http(s) URL to open, e.g. the policies. */
    link: string | null;
}

export interface IChecklistTemplate extends Document {
    organizationId: Types.ObjectId;
    name: string;
    /** Lower-cased name, for the per-organization, per-kind uniqueness index. */
    nameKey: string;
    kind: LifecycleKind;
    /** The one preselected when starting a process of this kind. */
    isDefault: boolean;
    tasks: ITemplateTask[];
    isDeleted: boolean;
    deletedAt: Date | null;
    deletedBy: Types.ObjectId | null;
    createdBy: Types.ObjectId | null;
    updatedBy: Types.ObjectId | null;
    createdAt: Date;
    updatedAt: Date;
}

const templateTaskSchema = new Schema<ITemplateTask>(
    {
        key: { type: String, required: true },
        title: { type: String, required: true, trim: true },
        instructions: { type: String, default: '' },
        assignee: {
            kind: { type: String, enum: ASSIGNEE_KINDS, required: true },
            userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        },
        dueOffsetDays: { type: Number, required: true },
        type: { type: String, enum: CHECKLIST_TASK_TYPES, required: true },
        questions: { type: [String], default: [] },
        link: { type: String, default: null },
    },
    { _id: false }
);

const checklistTemplateSchema = new Schema<IChecklistTemplate>(
    {
        organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
        name: { type: String, required: true, trim: true },
        nameKey: { type: String, required: true },
        kind: { type: String, enum: LIFECYCLE_KINDS, required: true },
        isDefault: { type: Boolean, default: false },
        tasks: { type: [templateTaskSchema], default: [] },
        isDeleted: { type: Boolean, default: false },
        deletedAt: { type: Date, default: null },
        deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { timestamps: true }
);

checklistTemplateSchema.pre('validate', function setKey() {
    this.nameKey = this.name.trim().toLowerCase();
});
checklistTemplateSchema.index({ organizationId: 1, kind: 1, nameKey: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
// One default per kind: a second "make default" racing the first fails here instead of leaving two.
checklistTemplateSchema.index({ organizationId: 1, kind: 1 }, { unique: true, partialFilterExpression: { isDefault: true, isDeleted: false } });

export const ChecklistTemplateModel = model<IChecklistTemplate>('ChecklistTemplate', checklistTemplateSchema);
