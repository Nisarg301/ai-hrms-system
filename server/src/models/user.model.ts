import { Schema, model, Document, Types } from 'mongoose';
import { USER_ROLES, USER_STATUSES, UserRoleName, UserStatus } from '../constants/roles';

export interface IUser extends Document {
    organizationId: Types.ObjectId | null;
    name: string;
    email: string;
    passwordHash: string;
    role: UserRoleName;
    roleId: Types.ObjectId | null;
    jobTitle: string | null;
    avatar: {
        id: Types.ObjectId | null;
        originalName: string | null;
        mimeType: string | null;
        size: number;
    };
    department: Types.ObjectId | null;
    /** Reporting manager (same organization). Defines "my team". */
    reportsTo: Types.ObjectId | null;
    /** YYYY-MM-DD, set by the ORG_ADMIN. null = treat the account's creation date as the joining date. */
    joiningDate: string | null;
    /** YYYY-MM-DD. Private: colleagues only ever see the day and month (Celebrations, profile). */
    dateOfBirth: string | null;
    /** "Introduce yourself" answers, edited only by the user themselves. */
    introduction: {
        about: string;
        hobbies: string;
        lovesAboutJob: string;
    };
    status: UserStatus;
    mustChangePassword: boolean;
    refreshTokenHash: string | null;
    resetPasswordTokenHash: string | null;
    resetPasswordExpiresAt: Date | null;
    isDeleted: boolean;
    deletedAt: Date | null;
    deletedBy: Types.ObjectId | null;
    createdBy: Types.ObjectId | null;
    updatedBy: Types.ObjectId | null;
    createdAt: Date;
    updatedAt: Date;
}

const userSchema = new Schema<IUser>(
    {
        organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
        name: { type: String, required: true, trim: true },
        email: { type: String, required: true, trim: true, lowercase: true },
        passwordHash: { type: String, required: true },
        avatar: {
            id: { type: Schema.Types.ObjectId, default: null },
            originalName: { type: String, default: null },
            mimeType: { type: String, default: null },
            size: { type: Number, default: 0 },
        },
        role: { type: String, enum: USER_ROLES, required: true },
        roleId: { type: Schema.Types.ObjectId, ref: 'Role', default: null },
        jobTitle: { type: String, trim: true, default: null },
        department: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
        reportsTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        joiningDate: { type: String, default: null },
        dateOfBirth: { type: String, default: null },
        introduction: {
            about: { type: String, trim: true, maxlength: 1000, default: '' },
            hobbies: { type: String, trim: true, maxlength: 1000, default: '' },
            lovesAboutJob: { type: String, trim: true, maxlength: 1000, default: '' },
        },
        status: { type: String, enum: USER_STATUSES, default: 'active' },
        mustChangePassword: { type: Boolean, default: false },
        refreshTokenHash: { type: String, default: null },
        resetPasswordTokenHash: { type: String, default: null },
        resetPasswordExpiresAt: { type: Date, default: null },
        isDeleted: { type: Boolean, default: false },
        deletedAt: { type: Date, default: null },
        deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { timestamps: true }
);

// Email unique among non-deleted accounts only, so a soft-deleted user's email
// (including a soft-deleted Employee's) can be reused for a new account.
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

export const UserModel = model<IUser>('User', userSchema);
