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

/** GET /documents filters, next to page/limit/search/sortBy/sortDir. */
export const listDocumentsQuerySchema = z.object({
  /** One category, matched whole and without regard to case. */
  category: z.string().trim().min(1).max(100).optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
});
