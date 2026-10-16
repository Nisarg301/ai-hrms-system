import { Schema, model, Document, Types } from 'mongoose';
import { MODULES, ModuleName } from '../constants/modules';
import { USER_ROLES, UserRoleName } from '../constants/roles';

export const AUDIT_ACTIONS = ['create', 'update', 'delete', 'login', 'logout'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// Besides the permission-matrix modules, these areas are audited too (they're
// available to every member or ORG_ADMIN-only, so they aren't matrix modules).
export const EXTRA_AUDIT_MODULES = ['roles', 'holidays', 'announcements', 'leave', 'posts', 'attendance', 'expenses', 'onboarding', 'performance'] as const;
export const AUDIT_MODULES = [...MODULES, ...EXTRA_AUDIT_MODULES] as const;
export type AuditModule = ModuleName | (typeof EXTRA_AUDIT_MODULES)[number];

export interface IAuditLog extends Document {
    organizationId: Types.ObjectId;
    actorId: Types.ObjectId;
    /** Copied at write time so the log still reads correctly after a rename or delete. */
    actorName: string;
    actorRole: UserRoleName;
    action: AuditAction;
    /** null for login/logout. */
    module: AuditModule | null;
    recordId: string | null;
    recordLabel: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    // Present only so BaseRepository's not-deleted filter matches; audit records are never deleted.
    isDeleted: boolean;
    createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
    {
        organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
        actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        actorName: { type: String, required: true },
        actorRole: { type: String, enum: USER_ROLES, required: true },
        action: { type: String, enum: AUDIT_ACTIONS, required: true },
        module: { type: String, enum: [...AUDIT_MODULES, null], default: null },
        recordId: { type: String, default: null },
        recordLabel: { type: String, default: null },
        ipAddress: { type: String, default: null },
        userAgent: { type: String, default: null },
        isDeleted: { type: Boolean, default: false },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ organizationId: 1, createdAt: -1 });

export const AuditLogModel = model<IAuditLog>('AuditLog', auditLogSchema);
