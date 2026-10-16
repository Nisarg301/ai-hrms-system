export type PraiseBadge = 'teamwork' | 'above_and_beyond' | 'customer_first' | 'innovation' | 'leadership' | 'thank_you';

export interface PraisePayload {
  recipientIds: string[];
  badge: PraiseBadge;
}

export interface PraisedPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
}

export interface Post {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  authorJobTitle: string | null;
  body: string;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
  canDelete: boolean;
  /** Set when the post praises colleagues. */
  praise: { badge: PraiseBadge; recipients: PraisedPerson[] } | null;
}

export interface PostComment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  authorJobTitle: string | null;
  body: string;
  createdAt: string;
  canDelete: boolean;
}

export interface FeedPage {
  items: Post[];
  /** Pass back as `cursor` for the next page; null = no more. */
  nextCursor: string | null;
}

export interface LikeResult {
  likeCount: number;
  likedByMe: boolean;
}
