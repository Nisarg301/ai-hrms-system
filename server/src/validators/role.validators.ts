import { z } from 'zod';
import { MODULES } from '../constants/modules';

const permissionEntrySchema = z.object({
  module: z.enum(MODULES),
  read: z.boolean(),
  create: z.boolean(),
  update: z.boolean(),
  delete: z.boolean(),
});

export const createRoleSchema = z.object({
  name: z.string().min(1),
  permissions: z.array(permissionEntrySchema).default([]),
});

export const updateRoleSchema = z.object({
  name: z.string().min(1).optional(),
  permissions: z.array(permissionEntrySchema).optional(),
});
