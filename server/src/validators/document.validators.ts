import { z } from 'zod';
import { DOCUMENT_STATUSES } from '../models/document.model';

export const createDocumentSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  category: z.string().trim().min(1),
  status: z.enum(DOCUMENT_STATUSES).default('active'),
});

export const updateDocumentSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
});
