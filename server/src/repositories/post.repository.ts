import { Types } from 'mongoose';
import { IPost, PostModel } from '../models/post.model';
import { BaseRepository } from './base.repository';

export class PostRepository extends BaseRepository<IPost> {
  constructor() {
    super(PostModel);
  }

  /** One page of the feed, newest first; `before` is the last post id of the previous page. */
  feedPage(organizationId: Types.ObjectId, before: string | undefined, limit: number): Promise<IPost[]> {
    const filter = { organizationId, isDeleted: false, ...(before ? { _id: { $lt: new Types.ObjectId(before) } } : {}) };
    return PostModel.find(filter).sort({ _id: -1 }).limit(limit);
  }
}

export const postRepository = new PostRepository();
