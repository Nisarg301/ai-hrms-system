import { z } from 'zod';

export const employeeSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  jobTitle: z.string().trim().min(1, 'Job title is required'),
  department: z.string().trim().min(1, 'Department is required'),
  roleId: z.string().trim().min(1, 'Role is required'),
  status: z.enum(['active', 'disabled']).optional(),
  /** '' = no manager. */
  reportsTo: z.string(),
  /** YYYY-MM-DD, or '' to leave it as the account's creation date. */
  joiningDate: z.string(),
  /** YYYY-MM-DD, or '' for none. */
  dateOfBirth: z.string(),
});

export type EmployeeFormValues = z.infer<typeof employeeSchema>;
