import { SendOutlined, TrophyOutlined } from '@ant-design/icons';
import { Button, Card, Input, message } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { useEffect, useState, type RefObject } from 'react';
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
            placeholder="Share an update, a win or a thank-you with everyone…"
            autoSize={{ minRows: 2, maxRows: 8 }}
            maxLength={POST_MAX}
            showCount
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void onPost();
            }}
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button icon={<TrophyOutlined />} onClick={() => setPraising(true)}>
              Praise
            </Button>
            <Button type="primary" icon={<SendOutlined />} disabled={!trimmed} loading={posting} onClick={onPost}>
              Post
            </Button>
          </div>
        </div>
      </div>
      <PraiseModal open={praising} myId={me?.id ?? ''} onClose={() => setPraising(false)} />
    </Card>
  );
}
