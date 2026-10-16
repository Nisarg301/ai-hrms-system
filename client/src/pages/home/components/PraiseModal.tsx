import { Alert, Form, Input, message, Modal, Select, theme } from 'antd';
import { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../../hooks/store';
import { createPost } from '../../../store/posts/postsThunks';
import { selectPeople } from '../../../store/team/teamSelectors';
import { fetchPeople } from '../../../store/team/teamThunks';
import type { PraiseBadge } from '../../../types/post';
import { PRAISE_BADGE_ORDER, PRAISE_BADGES } from '../../../utils/praise';

export const MAX_PRAISE_RECIPIENTS = 5;

interface PraiseModalProps {
  open: boolean;
  myId: string;
  onClose: () => void;
}

/** Praise 1–5 colleagues with a badge and a message; it posts to the feed. */
export function PraiseModal({ open, myId, onClose }: PraiseModalProps) {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const people = useAppSelector(selectPeople).filter((p) => p.id !== myId);
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [badge, setBadge] = useState<PraiseBadge | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    void dispatch(fetchPeople());
    setRecipientIds([]);
    setBadge(null);
    setBody('');
    setError(null);
  }, [open, dispatch]);

  const ready = recipientIds.length > 0 && badge !== null && body.trim().length > 0;

  const onSubmit = async () => {
    if (!ready || !badge) return;
    setSaving(true);
    setError(null);
    const result = await dispatch(createPost({ body: body.trim(), praise: { recipientIds, badge } }));
    setSaving(false);
    if (createPost.rejected.match(result)) {
      setError(result.payload ?? 'Could not post your praise');
      return;
    }
    void message.success('Praise posted 🎉');
    onClose();
  };

  return (
    <Modal
      open={open}
      title="Praise a colleague"
      okText="Post praise"
      okButtonProps={{ disabled: !ready }}
      confirmLoading={saving}
      onOk={onSubmit}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form layout="vertical">
        <Form.Item label="Who are you praising?" htmlFor="praise-people" help={`Up to ${MAX_PRAISE_RECIPIENTS} people.`}>
          <Select
            id="praise-people"
            mode="multiple"
            showSearch
            optionFilterProp="label"
            maxCount={MAX_PRAISE_RECIPIENTS}
            placeholder="Search colleagues"
            value={recipientIds}
            onChange={setRecipientIds}
            options={people.map((p) => ({ value: p.id, label: p.jobTitle ? `${p.name} · ${p.jobTitle}` : p.name }))}
          />
        </Form.Item>

        <Form.Item label="For">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Badge">
            {PRAISE_BADGE_ORDER.map((key) => {
              const b = PRAISE_BADGES[key];
              const chosen = badge === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  onClick={() => setBadge(key)}
                  className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-left text-sm"
                  style={{
                    border: `1.5px solid ${chosen ? b.color : token.colorBorderSecondary}`,
                    background: chosen ? `${b.color}14` : token.colorBgContainer,
                    fontWeight: chosen ? 600 : 400,
                  }}
                >
                  <span aria-hidden className="text-lg">
                    {b.emoji}
                  </span>
                  {b.label}
                </button>
              );
            })}
          </div>
        </Form.Item>

        <Form.Item label="Message" htmlFor="praise-message">
          <Input.TextArea
            id="praise-message"
            rows={4}
            maxLength={2000}
            showCount
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What did they do that made a difference?"
          />
        </Form.Item>
        {error ? <Alert type="error" showIcon message={error} /> : null}
      </Form>
    </Modal>
  );
}
