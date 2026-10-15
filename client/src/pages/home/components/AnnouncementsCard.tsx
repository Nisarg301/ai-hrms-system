import { DeleteOutlined, EditOutlined, NotificationOutlined, PushpinFilled } from '@ant-design/icons';
import { Button, message, Tag, theme, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { confirmAction } from '../../../components/ConfirmDialog/confirmDialog';
import { useAppDispatch } from '../../../hooks/store';
import { deleteAnnouncement } from '../../../store/home/homeThunks';
import type { Announcement } from '../../../types/announcement';
import { fromNow } from '../../../utils/dates';
import { HomeCard } from './HomeCard';

interface AnnouncementsCardProps {
  announcements: Announcement[];
  isAdmin: boolean;
  onEdit: (announcement: Announcement) => void;
}

function AnnouncementItem({ item, isAdmin, onEdit }: { item: Announcement; isAdmin: boolean; onEdit: () => void }) {
  const { token } = theme.useToken();
  const dispatch = useAppDispatch();
  const [expanded, setExpanded] = useState(false);

  const onDelete = () =>
    confirmAction({
      title: 'Delete this announcement?',
      content: `"${item.title}" will be removed for everyone.`,
      okText: 'Delete',
      onConfirm: async () => {
        const result = await dispatch(deleteAnnouncement(item.id));
        if (deleteAnnouncement.rejected.match(result)) {
          void message.error(result.payload ?? 'Could not delete the announcement');
        }
      },
    });

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: item.pinned ? token.colorPrimaryBg : token.colorFillQuaternary,
        border: `1px solid ${item.pinned ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {item.pinned ? (
              <Tag color="blue" icon={<PushpinFilled />} className="!mr-0">
                Pinned
              </Tag>
            ) : null}
            <Typography.Text strong>{item.title}</Typography.Text>
          </div>
          <div className="mt-1 text-xs" style={{ color: token.colorTextSecondary }}>
            {item.createdByName ? `${item.createdByName} · ` : ''}
            {fromNow(item.createdAt)}
          </div>
        </div>
        {isAdmin ? (
          <div className="flex shrink-0">
            <Tooltip title="Edit">
              <Button type="text" size="small" icon={<EditOutlined />} aria-label={`Edit ${item.title}`} onClick={onEdit} />
            </Tooltip>
            <Tooltip title="Delete">
              <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={`Delete ${item.title}`} onClick={onDelete} />
            </Tooltip>
          </div>
        ) : null}
      </div>
      <Typography.Paragraph
        className="!mb-0 mt-2 whitespace-pre-line"
        ellipsis={expanded ? false : { rows: 3, expandable: true, symbol: 'Read more', onExpand: () => setExpanded(true) }}
      >
        {item.body}
      </Typography.Paragraph>
    </div>
  );
}

export function AnnouncementsCard({ announcements, isAdmin, onEdit }: AnnouncementsCardProps) {
  // Members only see the card when there's something in it; admins always, to post one.
  if (announcements.length === 0 && !isAdmin) return null;
  return (
    <HomeCard title="Announcements" icon={<NotificationOutlined />}>
      {announcements.length === 0 ? (
        <div className="py-2 text-center text-sm opacity-70">No announcements yet. Share news with everyone using “New announcement”.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {announcements.map((a) => (
            <AnnouncementItem key={a.id} item={a} isAdmin={isAdmin} onEdit={() => onEdit(a)} />
          ))}
        </div>
      )}
    </HomeCard>
  );
}
