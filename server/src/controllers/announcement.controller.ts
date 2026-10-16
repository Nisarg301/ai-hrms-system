import { Request, Response } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler';
import { announcementRepository } from '../repositories/announcement.repository';
import { announcementService } from '../services/announcement.service';
import { auditCrud } from '../services/audit.service';
import { notify, snippet } from '../services/notification.service';
import { activeMembers } from '../services/people.service';
import { successResponse, ApiError } from '../utils/apiResponse';

/** Active announcements for everyone; `?all=true` lets an ORG_ADMIN also see expired ones. */
export const listAnnouncements = asyncHandler(async (req: Request, res: Response) => {
  const includeExpired = req.query.all === 'true' && req.user!.role === 'ORG_ADMIN';
  const items = await announcementService.list(req.orgFilter!.organizationId, { includeExpired });
  res.status(200).json(successResponse(items));
});

export const createAnnouncement = asyncHandler(async (req: Request, res: Response) => {
  const announcement = await announcementRepository.create(
    {
      organizationId: req.orgFilter!.organizationId,
      title: req.body.title,
      body: req.body.body,
      pinned: req.body.pinned,
      expiresOn: req.body.expiresOn,
    },
    req.user!.id
  );
  await auditCrud(req, 'create', 'announcements', { id: announcement._id!.toString(), label: announcement.title });
  const members = await activeMembers(req.orgFilter!.organizationId);
  await notify(
    req.orgFilter!.organizationId,
    members.map((m) => m._id),
    { type: 'announcement', title: `New announcement: ${announcement.title}`, body: snippet(announcement.body), link: '/home' },
    req.user!.id
  );
  res.status(201).json(successResponse(await announcementService.one(announcement)));
});

export const updateAnnouncement = asyncHandler(async (req: Request, res: Response) => {
  const existing = await announcementRepository.findById(req.params.id, { organizationId: req.orgFilter!.organizationId });
  if (!existing) {
    throw new ApiError(404, 'Announcement not found');
  }
  const updated = await announcementRepository.updateById(req.params.id, req.body, req.user!.id);
  await auditCrud(req, 'update', 'announcements', { id: req.params.id, label: updated!.title });
  res.status(200).json(successResponse(await announcementService.one(updated!)));
});

export const deleteAnnouncement = asyncHandler(async (req: Request, res: Response) => {
  const existing = await announcementRepository.findById(req.params.id, { organizationId: req.orgFilter!.organizationId });
  if (!existing) {
    throw new ApiError(404, 'Announcement not found');
  }
  await announcementRepository.softDelete(req.params.id, req.user!.id);
  await auditCrud(req, 'delete', 'announcements', { id: req.params.id, label: existing.title });
  res.status(200).json(successResponse({ id: req.params.id, deleted: true }));
});
