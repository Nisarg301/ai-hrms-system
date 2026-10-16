import { Types } from 'mongoose';
import { IAnnouncement } from '../models/announcement.model';
import { announcementRepository } from '../repositories/announcement.repository';
import { UserModel } from '../models/user.model';
import { todayIso } from '../utils/dates';

export type AnnouncementView = ReturnType<typeof toView>;

function toView(a: IAnnouncement, authorNames: Map<string, string>, today: string) {
  return {
    id: a._id!.toString(),
    title: a.title,
    body: a.body,
    pinned: a.pinned,
    expiresOn: a.expiresOn,
    expired: a.expiresOn !== null && a.expiresOn < today,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    createdByName: a.createdBy ? (authorNames.get(a.createdBy.toString()) ?? null) : null,
  };
}

export const announcementService = {
  /**
   * Pinned first, then newest. By default only active ones (no expiry, or
   * expiring today or later); `includeExpired` is for the ORG_ADMIN's editing.
   */
  async list(organizationId: Types.ObjectId, options: { includeExpired?: boolean; limit?: number } = {}): Promise<AnnouncementView[]> {
    const today = todayIso();
    const filter = options.includeExpired
      ? { organizationId }
      : { organizationId, $or: [{ expiresOn: null }, { expiresOn: { $gte: today } }] };
    const items = await announcementRepository.find(filter);
    // Ties broken by id (ObjectIds grow with insertion), so same-millisecond posts keep their order.
    items.sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        String(b._id).localeCompare(String(a._id))
    );
    const limited = options.limit ? items.slice(0, options.limit) : items;

    const authorIds = [...new Set(limited.map((a) => a.createdBy?.toString()).filter((id): id is string => Boolean(id)))];
    // Straight from the model (not the repository), so an author who has since been
    // deleted still shows by name.
    const authors = authorIds.length ? await UserModel.find({ _id: { $in: authorIds } }, { name: 1 }) : [];
    const authorNames = new Map(authors.map((u) => [u._id.toString(), u.name]));
    return limited.map((a) => toView(a, authorNames, today));
  },

  async one(announcement: IAnnouncement): Promise<AnnouncementView> {
    const author = announcement.createdBy ? await UserModel.findById(announcement.createdBy, { name: 1 }) : null;
    const names = new Map(author ? [[author._id.toString(), author.name]] : []);
    return toView(announcement, names, todayIso());
  },
};
