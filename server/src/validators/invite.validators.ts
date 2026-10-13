import { z } from 'zod';

export const inviteOrgAdminSchema = z
  .object({
    name: z.string().min(1),
    email: z.string().email(),
    organizationId: z.string().min(1).optional(),
    organizationName: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.organizationId) || Boolean(data.organizationName), {
    message: 'Either organizationId or organizationName is required',
    path: ['organizationName'],
  });
