import { DeleteOutlined } from '@ant-design/icons';
import { Alert, Button, Input, message, Skeleton, theme, Tooltip } from 'antd';
import { useEffect, useState } from 'react';
import { confirmAction } from '../../../components/ConfirmDialog/confirmDialog';
import { PersonAvatar } from '../../../components/PersonAvatar/PersonAvatar';
import { useAppDispatch, useAppSelector } from '../../../hooks/store';
import { selectComments } from '../../../store/posts/postsSelectors';
import { addComment, deleteComment, fetchComments } from '../../../store/posts/postsThunks';
import { fromNow } from '../../../utils/dates';

const COMMENT_MAX = 1000;

interface PostCommentsProps {
  postId: string;
  myName: string;
  myAvatarUrl: string | null | undefined;
}

/** A post's comments: loaded when first opened, oldest first, with a reply box. */
export function PostComments({ postId, myName, myAvatarUrl }: PostCommentsProps) {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const thread = useAppSelector(selectComments(postId));
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    void dispatch(fetchComments(postId));
  }, [dispatch, postId]);

  const onSend = async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setSending(true);
    const result = await dispatch(addComment({ postId, body: trimmed }));
    setSending(false);
    if (addComment.rejected.match(result)) {
      void message.error(result.payload ?? 'Could not add your comment');
      return;
    }
    setBody('');
  };

  const onDelete = (commentId: string) =>
    confirmAction({
      title: 'Delete this comment?',
      content: 'It will be removed for everyone.',
      okText: 'Delete',
      onConfirm: async () => {
        const result = await dispatch(deleteComment({ postId, commentId }));
        if (deleteComment.rejected.match(result)) {
          void message.error(result.payload ?? 'Could not delete the comment');
        }
      },
    });

  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: token.colorBorderSecondary }}>
      {thread.status === 'failed' ? <Alert type="error" showIcon message={thread.error} className="mb-3" /> : null}
      {thread.status === 'loading' && thread.items.length === 0 ? <Skeleton active avatar paragraph={{ rows: 1 }} /> : null}

      <div className="flex flex-col gap-3">
        {thread.items.map((c) => (
          <div key={c.id} className="flex gap-2">
            <PersonAvatar name={c.authorName} avatarUrl={c.authorAvatarUrl} size="small" />
            <div className="min-w-0 flex-1 rounded-xl px-3 py-2" style={{ background: token.colorFillTertiary }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{c.authorName}</span>
                <span className="flex items-center gap-1 text-xs" style={{ color: token.colorTextSecondary }}>
                  {fromNow(c.createdAt)}
                  {c.canDelete ? (
                    <Tooltip title="Delete comment">
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label="Delete comment" onClick={() => onDelete(c.id)} />
                    </Tooltip>
                  ) : null}
                </span>
              </div>
              <div className="whitespace-pre-line break-words text-sm">{c.body}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <PersonAvatar name={myName} avatarUrl={myAvatarUrl} size="small" />
        <Input.TextArea
          aria-label="Write a comment"
          placeholder="Write a comment…"
          autoSize={{ minRows: 1, maxRows: 4 }}
          maxLength={COMMENT_MAX}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              void onSend();
            }
          }}
        />
        <Button type="primary" disabled={!body.trim()} loading={sending} onClick={onSend}>
          Reply
        </Button>
      </div>
    </div>
  );
}
