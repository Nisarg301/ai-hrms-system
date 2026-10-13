import { Types } from 'mongoose';
import { IPostComment, PostCommentModel } from '../models/postComment.model';
import { BaseRepository } from './base.repository';

export class PostCommentRepository extends BaseRepository<IPostComment> {
  constructor() {
    super(PostCommentModel);
  }

  /** A post's comments, oldest first. */
  forPost(postId: Types.ObjectId): Promise<IPostComment[]> {
    return PostCommentModel.find({ postId, isDeleted: false }).sort({ _id: 1 });
  }

  /** Soft-deletes every comment of a post (when the post itself is deleted). */
  async softDeleteForPost(postId: Types.ObjectId, actorId: string): Promise<void> {
    await PostCommentModel.updateMany({ postId, isDeleted: false }, { isDeleted: true, deletedAt: new Date(), deletedBy: actorId });
  }
}

export const postCommentRepository = new PostCommentRepository();
