export interface Announcement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  /** YYYY-MM-DD, shown up to and including this day; null = no expiry. */
  expiresOn: string | null;
  expired: boolean;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
}

export interface AnnouncementPayload {
  title: string;
  body: string;
  pinned: boolean;
  expiresOn: string | null;
}
