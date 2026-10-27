import { SendOutlined, TrophyOutlined } from '@ant-design/icons';
import { Button, Card, Input, Typography, message } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { useEffect, useId, useState, type RefObject } from 'react';
import { PersonAvatar } from '../../../components/PersonAvatar/PersonAvatar';
import { createPost } from '../../../store/posts/postsThunks';
import { selectAuthUser } from '../../../store/auth/authSelectors';
import { useAppDispatch, useAppSelector } from '../../../hooks/store';
import { PraiseModal } from './PraiseModal';

export const POST_MAX = 2000;

interface PostComposerProps {
  name: string;
  avatarUrl: string | null | undefined;
  /** Lets "New post" in the greeting focus the box. */
  inputRef?: RefObject<TextAreaRef | null>;
  /** Text to put in the box (e.g. a birthday wish); a new `key` puts it in again. */
  prefill?: { text: string; key: number } | null;
}

export function PostComposer({ name, avatarUrl, inputRef, prefill }: PostComposerProps) {
  const dispatch = useAppDispatch();
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [praising, setPraising] = useState(false);
  const me = useAppSelector(selectAuthUser);
  const countId = useId();

  useEffect(() => {
    if (!prefill) return;
    setBody(prefill.text);
    inputRef?.current?.focus({ cursor: 'end' });
    // Only when a new prefill arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.key]);
  const trimmed = body.trim();

  const onPost = async () => {
    if (!trimmed) return;
    setPosting(true);
    const result = await dispatch(createPost({ body: trimmed }));
    setPosting(false);
    if (createPost.rejected.match(result)) {
      void message.error(result.payload ?? 'Could not share your post');
      return;
    }
    setBody('');
  };

  return (
    <Card className="mb-4">
      <div className="flex gap-3">
        <PersonAvatar name={name} avatarUrl={avatarUrl} />
        <div className="flex-1">
          <Input.TextArea
            ref={inputRef}
            aria-label="Write a post"
            aria-describedby={countId}
            placeholder="Share an update, a win or a thank-you with everyone…"
            autoSize={{ minRows: 2, maxRows: 8 }}
            maxLength={POST_MAX}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void onPost();
            }}
          />
          {/* The count sits in the action row: antd's showCount hangs below the box and ran into the buttons. */}
          <div className="mt-3 flex items-center justify-between gap-2">
            <Typography.Text id={countId} type={body.length >= POST_MAX * 0.9 ? 'warning' : 'secondary'} className="text-xs tabular-nums">
              {body.length} / {POST_MAX}
            </Typography.Text>
            <div className="flex gap-2">
              <Button icon={<TrophyOutlined />} onClick={() => setPraising(true)}>
                Praise
              </Button>
              <Button type="primary" icon={<SendOutlined />} disabled={!trimmed} loading={posting} onClick={onPost}>
                Post
              </Button>
            </div>
          </div>
        </div>
      </div>
      <PraiseModal open={praising} myId={me?.id ?? ''} onClose={() => setPraising(false)} />
    </Card>
  );
}
