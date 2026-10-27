import { Request, Response } from 'express';
import { QueryFilter } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { documentRepository } from '../repositories/document.repository';
import { auditCrud } from '../services/audit.service';
import { successResponse, ApiError } from '../utils/apiResponse';
import { parsePaginationQuery } from '../utils/pagination';
import { IDocumentRecord } from '../models/document.model';
import { uploadFile, deleteFile, downloadFile } from '../services/gridfs.service';
import { containsPattern, escapeRegex } from '../utils/regex';
import { listDocumentsQuerySchema } from '../validators/document.validators';

function serialize(d: IDocumentRecord) {
  return {
    id: d._id.toString(),
    title: d.title,
    description: d.description,
    category: d.category,
    status: d.status,
    // The nested schema defaults fill `file` in even when nothing was uploaded,
    // so a real attachment is one with an id.
    file: d.file?.id
      ? {
          id: d.file.id.toString(),
          originalName: d.file.originalName,
          mimeType: d.file.mimeType,
          size: d.file.size,
        }
      : null,
  };
}

export const createDocument = asyncHandler(async (req: Request, res: Response) => {
  let fileData = null;

  if (req.file) {
    const fileId = await uploadFile({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });
    fileData = {
      id: fileId,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
    };
  }

  const document = await documentRepository.create(
    {
      organizationId: req.orgFilter!.organizationId,
      title: req.body.title,
      description: req.body.description,
      category: req.body.category,
      status: req.body.status,
      file: fileData,
    },
    req.user!.id
  );
  await auditCrud(req, 'create', 'documents', { id: document._id.toString(), label: document.title });
  res.status(201).json(successResponse(serialize(document)));
});

export const listDocuments = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip, search, sortBy, sortDir } = parsePaginationQuery(req.query as Record<string, unknown>);
  const filter: QueryFilter<IDocumentRecord> = { organizationId: req.orgFilter!.organizationId };
  if (search) {
    filter.$or = [{ title: containsPattern(search) }, { category: containsPattern(search) }];
  }
  // Optional filters (the AI assistant lists "HR documents" or "archived documents" with these).
  const filters = listDocumentsQuerySchema.safeParse(req.query);
  if (!filters.success) {
    throw new ApiError(400, 'Validation failed', filters.error.flatten());
  }
  if (filters.data.category) filter.category = new RegExp(`^${escapeRegex(filters.data.category)}$`, 'i');
  if (filters.data.status) filter.status = filters.data.status;
  const { items, total } = await documentRepository.paginate({ filter, skip, limit, sortBy, sortDir });
  res.status(200).json(successResponse(items.map(serialize), { page, limit, total }));
});

export const getDocument = asyncHandler(async (req: Request, res: Response) => {
  const document = await documentRepository.findById(req.params.id, { organizationId: req.orgFilter!.organizationId });
  if (!document) {
    throw new ApiError(404, 'Document not found');
  }
  res.status(200).json(successResponse(serialize(document)));
});

export const updateDocument = asyncHandler(async (req: Request, res: Response) => {
  const existing = await documentRepository.findById(req.params.id, { organizationId: req.orgFilter!.organizationId });
  if (!existing) {
    throw new ApiError(404, 'Document not found');
  }

  // Extract non-file fields from req.body
  const { file: _ignored, ...bodyFields } = req.body;
  const updateData: Record<string, any> = { ...bodyFields };

  // If a new file was uploaded via multipart/form-data
  if (req.file) {
    const oldFileId = existing.file?.id;

    // 1. Upload the new file to GridFS
    const newFileId = await uploadFile({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    // 2. Delete the old file from GridFS if it existed
    if (oldFileId) {
      try {
        await deleteFile(oldFileId);
      } catch (err) {
        console.error('Failed to delete previous document file from GridFS:', err);
      }
    }

    // 3. Attach new file metadata to the update payload
    updateData.file = {
      id: newFileId,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
    };
  }

  const updated = await documentRepository.updateById(req.params.id, updateData, req.user!.id);
  await auditCrud(req, 'update', 'documents', { id: req.params.id, label: updated!.title });
  res.status(200).json(successResponse(serialize(updated!)));
});

export const downloadDocumentFile = asyncHandler(
  async (req: Request, res: Response) => {
    const document = await documentRepository.findById(
      req.params.id,
      {
        organizationId: req.orgFilter!.organizationId,
      }
    );

    if (!document || !document.file?.id) {
      throw new ApiError(404, 'Document or file not found');
    }

    res.setHeader(
      'Content-Type',
      document.file.mimeType || 'application/octet-stream'
    );

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(
        document.file.originalName
      )}"`
    );

    const downloadStream = downloadFile(document.file.id);

    downloadStream.on('error', (error) => {
      console.error('GridFS download error:', error);

      if (!res.headersSent) {
        res.status(404).json(new ApiError(404, 'File not found in storage'));
      }
    });

    downloadStream.pipe(res);
  }
);
export const deleteDocument = asyncHandler(async (req: Request, res: Response) => {
  const existing = await documentRepository.findById(req.params.id, { organizationId: req.orgFilter!.organizationId });
  if (!existing) {
    throw new ApiError(404, 'Document not found');
  }
  await documentRepository.softDelete(req.params.id, req.user!.id);
  await auditCrud(req, 'delete', 'documents', { id: req.params.id, label: existing.title });
  res.status(200).json(successResponse({ id: req.params.id, deleted: true }));
});
