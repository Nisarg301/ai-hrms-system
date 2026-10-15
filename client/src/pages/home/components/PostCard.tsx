import { CommentOutlined, DeleteOutlined, HeartFilled, HeartOutlined } from '@ant-design/icons';
import { Avatar, Button, Card, message, theme, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { confirmAction } from '../../../components/ConfirmDialog/confirmDialog';
import { PersonAvatar } from '../../../components/PersonAvatar/PersonAvatar';
import { useAppDispatch } from '../../../hooks/store';
import { deletePost, toggleLike } from '../../../store/posts/postsThunks';
import type { Post } from '../../../types/post';
import { fromNow } from '../../../utils/dates';
import { joinNames, PRAISE_BADGES } from '../../../utils/praise';
import { PostComments } from './PostComments';

interface PostCardProps {
  post: Post;
  myId: string;
  myName: string;
  myAvatarUrl: string | null | undefined;
}

export function PostCard({ post, myId, myName, myAvatarUrl }: PostCardProps) {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const [showComments, setShowComments] = useState(false);

  const onLike = async () => {
    // The count flips straight away; the slice puts it back if this fails.
    const result = await dispatch(toggleLike(post.id));
    if (toggleLike.rejected.match(result)) {
      void message.error(result.payload ?? 'Could not update your like');
    }
  };

  const onDelete = () =>
    confirmAction({
      title: 'Delete this post?',
      content: post.authorId === myId ? 'Your post and its comments will be removed.' : `${post.authorName}'s post and its comments will be removed for everyone.`,
      okText: 'Delete',
      onConfirm: async () => {
        const result = await dispatch(deletePost(post.id));
        if (deletePost.rejected.match(result)) {
          void message.error(result.payload ?? 'Could not delete the post');
        }
      },
    });

  const commentLabel = post.commentCount === 1 ? '1 comment' : `${post.commentCount} comments`;

  const praise = post.praise;
  const badge = praise ? PRAISE_BADGES[praise.badge] : null;

  return (
    <Card
      className="mb-4"
      data-testid="post-card"
      style={badge ? { borderColor: `${badge.color}55`, borderWidth: 1.5 } : undefined}
    >
      {praise && badge ? (
        <div
          className="-mx-6 -mt-6 mb-4 flex flex-wrap items-center gap-3 rounded-t-lg px-6 py-4"
          style={{ background: `linear-gradient(120deg, ${badge.color}22 0%, ${badge.color}08 100%)` }}
          data-testid="praise-banner"
        >
          <span
            className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold"
            style={{ background: `${badge.color}1f`, color: badge.color }}
          >
            <span aria-hidden>{badge.emoji}</span> {badge.label}
          </span>
          <Avatar.Group max={{ count: 5 }}>
            {praise.recipients.map((r) => (
              <Tooltip key={r.id} title={r.name}>
                <span>
                  <PersonAvatar name={r.name} avatarUrl={r.avatarUrl} />
                </span>
              </Tooltip>
            ))}
          </Avatar.Group>
          <span className="min-w-0 text-sm">
            <strong>{post.authorName}</strong> praised <strong>{joinNames(praise.recipients.map((r) => r.name))}</strong>
          </span>
        </div>
      ) : null}
      <div className="flex items-start gap-3">
        <PersonAvatar name={post.authorName} avatarUrl={post.authorAvatarUrl} size="large" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium">{post.authorName}</div>
              <div className="text-xs" style={{ color: token.colorTextSecondary }}>
                {post.authorJobTitle ? `${post.authorJobTitle} · ` : ''}
                {fromNow(post.createdAt)}
              </div>
            </div>
            {post.canDelete ? (
              <Tooltip title="Delete post">
                <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label="Delete post" onClick={onDelete} />
              </Tooltip>
            ) : null}
          </div>
          <Typography.Paragraph className="!mb-0 mt-3 whitespace-pre-line break-words">{post.body}</Typography.Paragraph>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 border-t pt-2" style={{ borderColor: token.colorBorderSecondary }}>
        <Button
          type="text"
          icon={post.likedByMe ? <HeartFilled style={{ color: token.colorError }} /> : <HeartOutlined />}
          aria-pressed={post.likedByMe}
          aria-label={post.likedByMe ? 'Unlike' : 'Like'}
          onClick={onLike}
        >
          {post.likeCount}
        </Button>
        <Button type="text" icon={<CommentOutlined />} aria-expanded={showComments} onClick={() => setShowComments((v) => !v)}>
          {commentLabel}
        </Button>
      </div>

      {showComments ? <PostComments postId={post.id} myName={myName} myAvatarUrl={myAvatarUrl} /> : null}
    </Card>
  );
}
