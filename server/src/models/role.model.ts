import { Schema, model, Document, Types } from 'mongoose';
import { MODULES, ModuleName } from '../constants/modules';

export interface IRolePermission {
  module: ModuleName;
  read: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
}

export interface IRole extends Document {
  organizationId: Types.ObjectId;
  name: string;
  permissions: IRolePermission[];
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const rolePermissionSchema = new Schema<IRolePermission>(
  {
    module: { type: String, enum: MODULES, required: true },
    read: { type: Boolean, default: false },
    create: { type: Boolean, default: false },
    update: { type: Boolean, default: false },
    delete: { type: Boolean, default: false },
  },
  { _id: false }
);

const roleSchema = new Schema<IRole>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    permissions: { type: [rolePermissionSchema], default: [] },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

export const RoleModel = model<IRole>('Role', roleSchema);
