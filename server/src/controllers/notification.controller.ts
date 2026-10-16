import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middlewares/asyncHandler';
import { INotification, NotificationModel } from '../models/notification.model';
import { successResponse, ApiError } from '../utils/apiResponse';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Only ever the signed-in person's own notifications, in their organization. */
function mine(req: Request) {
  return { userId: new Types.ObjectId(req.user!.id), organizationId: req.orgFilter!.organizationId };
}

function serialize(n: INotification) {
  return {
    id: String(n._id),
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    read: n.readAt !== null,
    createdAt: n.createdAt,
  };
}

export const listNotifications = asyncHandler(async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());
  const [items, unreadCount] = await Promise.all([
    NotificationModel.find(mine(req)).sort({ createdAt: -1, _id: -1 }).limit(parsed.data.limit),
    NotificationModel.countDocuments({ ...mine(req), readAt: null }),
  ]);
  res.status(200).json(successResponse({ items: items.map(serialize), unreadCount }));
});

export const unreadCount = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json(successResponse({ count: await NotificationModel.countDocuments({ ...mine(req), readAt: null }) }));
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  // Only an unread one changes, so the first time it was read is kept.
  const n =
    (await NotificationModel.findOneAndUpdate({ _id: req.params.id, ...mine(req), readAt: null }, { $set: { readAt: new Date() } }, { returnDocument: 'after' })) ??
    (await NotificationModel.findOne({ _id: req.params.id, ...mine(req) }));
  if (!n) throw new ApiError(404, 'Notification not found');
  res.status(200).json(successResponse(serialize(n)));
});

export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  const result = await NotificationModel.updateMany({ ...mine(req), readAt: null }, { $set: { readAt: new Date() } });
  res.status(200).json(successResponse({ updated: result.modifiedCount }));
});
