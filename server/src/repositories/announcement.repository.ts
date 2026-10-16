import { AnnouncementModel, IAnnouncement } from '../models/announcement.model';
import { BaseRepository } from './base.repository';

export class AnnouncementRepository extends BaseRepository<IAnnouncement> {
  constructor() {
    super(AnnouncementModel);
  }
}

export const announcementRepository = new AnnouncementRepository();
