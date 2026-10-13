import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { IPost, IPraise, PostModel, PraiseBadge } from '../models/post.model';
import { IPostComment } from '../models/postComment.model';
import { IUser, UserModel } from '../models/user.model';
import { postRepository } from '../repositories/post.repository';
import { postCommentRepository } from '../repositories/postComment.repository';
import { userRepository } from '../repositories/user.repository';
import { auditCrud } from '../services/audit.service';
import { avatarUrl } from '../services/people.service';
import { notify, snippet as quote } from '../services/notification.service';
import { feedQuerySchema } from '../validators/post.validators';
import { successResponse, ApiError } from '../utils/apiResponse';

export const PRAISE_BADGE_LABELS: Record<PraiseBadge, string> = {
  teamwork: 'Teamwork',
  above_and_beyond: 'Above & beyond',
  customer_first: 'Customer first',
  innovation: 'Innovation',
  leadership: 'Leadership',
  thank_you: 'Thank you',
};

/**
 * Authors (and people praised) by id. Straight from the model (not the
 * repository), so someone who has since been deleted still shows by name.
 */
async function authorsOf(items: { authorId: Types.ObjectId; praise?: IPraise | null }[]): Promise<Map<string, IUser>> {
  const ids = [...new Set(items.flatMap((i) => [i.authorId, ...(i.praise?.recipientIds ?? [])].map(String)))];
  const users = ids.length ? await UserModel.find({ _id: { $in: ids } }, { name: 1, jobTitle: 1, avatar: 1, updatedAt: 1 }) : [];
  return new Map(users.map((u) => [u._id.toString(), u]));
}

function authorFields(authorId: Types.ObjectId, authors: Map<string, IUser>) {
  const author = authors.get(authorId.toString());
  return {
    authorId: authorId.toString(),
    authorName: author?.name ?? 'Former member',
    authorAvatarUrl: author ? avatarUrl(author) : null,
    authorJobTitle: author?.jobTitle ?? null,
  };
}

/** The author, or any ORG_ADMIN, may delete a post or comment. */
function canDelete(req: Request, authorId: Types.ObjectId): boolean {
  return req.user!.role === 'ORG_ADMIN' || authorId.toString() === req.user!.id;
}

function toPostView(req: Request, post: IPost, authors: Map<string, IUser>) {
  return {
    id: post._id!.toString(),
    ...authorFields(post.authorId, authors),
    body: post.body,
    createdAt: post.createdAt,
    likeCount: post.likedBy.length,
    likedByMe: post.likedBy.some((id) => id.toString() === req.user!.id),
    commentCount: post.commentCount,
    canDelete: canDelete(req, post.authorId),
    praise: post.praise
      ? {
          badge: post.praise.badge,
          recipients: post.praise.recipientIds.map((id) => {
            const who = authors.get(String(id));
            return { id: String(id), name: who?.name ?? 'Former member', avatarUrl: who ? avatarUrl(who) : null, jobTitle: who?.jobTitle ?? null };
          }),
        }
      : null,
  };
}

function toCommentView(req: Request, comment: IPostComment, authors: Map<string, IUser>) {
  return {
    id: comment._id!.toString(),
    postId: comment.postId.toString(),
    ...authorFields(comment.authorId, authors),
    body: comment.body,
    createdAt: comment.createdAt,
    canDelete: canDelete(req, comment.authorId),
  };
}

async function findPostOr404(req: Request): Promise<IPost> {
  const post = await postRepository.findById(req.params.id, { organizationId: req.orgFilter!.organizationId });
  if (!post) {
    throw new ApiError(404, 'Post not found');
  }
  return post;
}

/** A short, single-line quote of a post for the audit log. */
function snippet(body: string): string {
  const line = body.replace(/\s+/g, ' ');
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

export const listPosts = asyncHandler(async (req: Request, res: Response) => {
  const parsed = feedQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ApiError(400, 'Validation failed', parsed.error.flatten());
  }
  const { cursor, limit } = parsed.data;
  // One extra tells us whether another page exists.
  const page = await postRepository.feedPage(req.orgFilter!.organizationId, cursor, limit + 1);
  const items = page.slice(0, limit);
  const authors = await authorsOf(items);
  res.status(200).json(
    successResponse({
      items: items.map((p) => toPostView(req, p, authors)),
      nextCursor: page.length > limit ? items[items.length - 1]._id!.toString() : null,
    })
  );
});

/** A praise's recipients: distinct, not the author, and active members of this organization. */
async function checkPraise(req: Request, praise: { recipientIds: string[]; badge: PraiseBadge }): Promise<IPraise> {
  const ids = [...new Set(praise.recipientIds)];
  const fieldError = (message: string) => new ApiError(400, message, { fieldErrors: { praise: [message] } });
  if (ids.includes(req.user!.id)) throw fieldError("You can't praise yourself");
  const found = await userRepository.find({
    organizationId: req.orgFilter!.organizationId,
    _id: { $in: ids },
    role: { $in: ['ORG_ADMIN', 'ORG_USER'] },
    status: 'active',
  });
  if (found.length !== ids.length) throw fieldError('Only active colleagues in your organization can be praised');
  return { recipientIds: ids.map((id) => new Types.ObjectId(id)), badge: praise.badge };
}

export const createPost = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const praise = req.body.praise ? await checkPraise(req, req.body.praise) : null;
  const post = await postRepository.create(
    { organizationId, authorId: new Types.ObjectId(req.user!.id), body: req.body.body, praise },
    req.user!.id
  );
  if (praise) {
    await notify(
      organizationId,
      praise.recipientIds,
      { type: 'praise', title: `${req.user!.name ?? 'A colleague'} praised you: ${PRAISE_BADGE_LABELS[praise.badge]}`, body: quote(post.body), link: '/home' },
      req.user!.id
    );
  }
  res.status(201).json(successResponse(toPostView(req, post, await authorsOf([post]))));
});

export const deletePost = asyncHandler(async (req: Request, res: Response) => {
  const post = await findPostOr404(req);
  if (!canDelete(req, post.authorId)) {
    throw new ApiError(403, 'You can only delete your own posts');
  }
  const deleted = await postRepository.softDelete(post._id as Types.ObjectId, req.user!.id);
  if (!deleted) {
    // Someone else deleted it a moment ago.
    throw new ApiError(404, 'Post not found');
  }
  await postCommentRepository.softDeleteForPost(post._id as Types.ObjectId, req.user!.id);
  // Only moderation is audited, not people tidying up their own posts.
  if (post.authorId.toString() !== req.user!.id) {
    const authors = await authorsOf([post]);
    const label = `Post by ${authorFields(post.authorId, authors).authorName}: "${snippet(post.body)}"`;
    await auditCrud(req, 'delete', 'posts', { id: req.params.id, label });
  }
  res.status(200).json(successResponse({ id: req.params.id, deleted: true }));
});

/**
 * Likes the post if the caller hasn't, otherwise unlikes it. Each branch is one
 * atomic update conditioned on the current state, so a member is never counted
 * twice and a concurrent like from someone else is never lost.
 */
export const toggleLike = asyncHandler(async (req: Request, res: Response) => {
  const me = new Types.ObjectId(req.user!.id);
  const base = { _id: req.params.id, organizationId: req.orgFilter!.organizationId, isDeleted: false };
  const options = { returnDocument: 'after' as const, projection: { likedBy: 1 } };

  let post =
    (await PostModel.findOneAndUpdate({ ...base, likedBy: { $ne: me } }, { $addToSet: { likedBy: me } }, options)) ??
    (await PostModel.findOneAndUpdate({ ...base, likedBy: me }, { $pull: { likedBy: me } }, options));
  if (!post) {
    // Neither matched: the post is gone, or the caller's other click just flipped it.
    post = await PostModel.findOne(base, { likedBy: 1 });
    if (!post) {
      throw new ApiError(404, 'Post not found');
    }
  }
  res.status(200).json(
    successResponse({ likeCount: post.likedBy.length, likedByMe: post.likedBy.some((id) => id.equals(me)) })
  );
});

export const listComments = asyncHandler(async (req: Request, res: Response) => {
  const post = await findPostOr404(req);
  const comments = await postCommentRepository.forPost(post._id as Types.ObjectId);
  const authors = await authorsOf(comments);
  res.status(200).json(successResponse(comments.map((c) => toCommentView(req, c, authors))));
});

export const createComment = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  // Counting first doubles as an atomic "the post still exists" check.
  const post = await PostModel.findOneAndUpdate(
    { _id: req.params.id, organizationId, isDeleted: false },
    { $inc: { commentCount: 1 } },
    { returnDocument: 'after' }
  );
  if (!post) {
    throw new ApiError(404, 'Post not found');
  }
  let comment: IPostComment;
  try {
    comment = await postCommentRepository.create(
      { postId: post._id as Types.ObjectId, organizationId, authorId: new Types.ObjectId(req.user!.id), body: req.body.body },
      req.user!.id
    );
  } catch (err) {
    await PostModel.updateOne({ _id: post._id }, { $inc: { commentCount: -1 } });
    throw err;
  }
  await notify(
    organizationId,
    [post.authorId],
    { type: 'post_comment', title: `${req.user!.name ?? 'Someone'} commented on your post`, body: quote(comment.body), link: '/home' },
    req.user!.id
  );
  res.status(201).json(
    successResponse({ comment: toCommentView(req, comment, await authorsOf([comment])), commentCount: post.commentCount })
  );
});

export const deleteComment = asyncHandler(async (req: Request, res: Response) => {
  const post = await findPostOr404(req);
  const comment = await postCommentRepository.findById(req.params.commentId, { postId: post._id });
  if (!comment) {
    throw new ApiError(404, 'Comment not found');
  }
  if (!canDelete(req, comment.authorId)) {
    throw new ApiError(403, 'You can only delete your own comments');
  }
  // softDelete only matches a live comment, so two deletes can't both decrement.
  const deleted = await postCommentRepository.softDelete(comment._id as Types.ObjectId, req.user!.id);
  if (!deleted) {
    throw new ApiError(404, 'Comment not found');
  }
  const updated = await PostModel.findOneAndUpdate(
    { _id: post._id, commentCount: { $gt: 0 } },
    { $inc: { commentCount: -1 } },
    { returnDocument: 'after', projection: { commentCount: 1 } }
  );
  res.status(200).json(successResponse({ id: req.params.commentId, deleted: true, commentCount: updated?.commentCount ?? 0 }));
});
