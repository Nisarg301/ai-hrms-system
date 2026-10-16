import type { MODULES } from '../constants/modules';

export type ModuleName = (typeof MODULES)[number];

export type PermissionAction = 'read' | 'create' | 'update' | 'delete';

export interface PermissionFlags {
  read: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
}

export interface PermissionEntry extends PermissionFlags {
  module: ModuleName;
}

export type PermissionMatrixValue = Record<ModuleName, PermissionFlags>;

export interface Role {
  id: string;
  name: string;
  permissions: PermissionEntry[];
}
