import { z } from 'zod';

/**
 * The backend requires exactly one of organizationName / organizationId. The
 * mode discriminator keeps the form honest so the request is always valid.
 */
export const inviteOrgAdminSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('new'),
    name: z.string().min(1, 'Name is required'),
    email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
    organizationName: z.string().min(1, 'Organization name is required'),
  }),
  z.object({
    mode: z.literal('existing'),
    name: z.string().min(1, 'Name is required'),
    email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
    organizationId: z.string().min(1, 'Select an organization'),
  }),
]);

export type InviteOrgAdminFormValues = z.infer<typeof inviteOrgAdminSchema>;
