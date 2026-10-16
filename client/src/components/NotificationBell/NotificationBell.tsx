import {
  AimOutlined,
  BellOutlined,
  CalendarOutlined,
  CarryOutOutlined,
  ClockCircleOutlined,
  CommentOutlined,
  FieldTimeOutlined,
  FlagOutlined,
  NotificationOutlined,
  RocketOutlined,
  TrophyOutlined,
  UsergroupAddOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { Badge, Button, Empty, Popover, Skeleton, theme } from 'antd';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectNotifications } from '../../store/notifications/notificationsSelectors';
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../store/notifications/notificationsThunks';
import type { AppNotification, NotificationType } from '../../types/notification';
import { fromNow } from '../../utils/dates';

/** How often the unread count is refreshed while the app is open (spec default 14). */
export const POLL_MS = 60_000;

const ICONS: Record<NotificationType, ReactNode> = {
  leave_requested: <CalendarOutlined />,
  leave_decided: <CalendarOutlined />,
  leave_recorded: <CalendarOutlined />,
  attendance_requested: <ClockCircleOutlined />,
  attendance_decided: <ClockCircleOutlined />,
  attendance_recorded: <ClockCircleOutlined />,
  post_comment: <CommentOutlined />,
  announcement: <NotificationOutlined />,
  praise: <TrophyOutlined />,
  expense_submitted: <WalletOutlined />,
  expense_decided: <WalletOutlined />,
  expense_paid: <WalletOutlined />,
  lifecycle_started: <RocketOutlined />,
  lifecycle_buddy: <UsergroupAddOutlined />,
  lifecycle_assigned: <CarryOutOutlined />,
  lifecycle_ready: <FlagOutlined />,
  lifecycle_reminder: <FieldTimeOutlined />,
  review_launched: <AimOutlined />,
  review_assigned: <AimOutlined />,
  review_submitted: <AimOutlined />,
  review_released: <AimOutlined />,
  review_reminder: <FieldTimeOutlined />,
};

export function NotificationBell() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const { items, unreadCount, status } = useAppSelector(selectNotifications);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void dispatch(fetchUnreadCount());
    const id = window.setInterval(() => void dispatch(fetchUnreadCount()), POLL_MS);
    return () => window.clearInterval(id);
  }, [dispatch]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) void dispatch(fetchNotifications());
  };

  const onPick = (n: AppNotification) => {
    if (!n.read) void dispatch(markNotificationRead(n.id));
    setOpen(false);
    navigate(n.link);
  };

  const content = (
    <div className="w-[360px] max-w-[85vw]">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold">Notifications</span>
        <Button type="link" size="small" disabled={unreadCount === 0} onClick={() => dispatch(markAllNotificationsRead())}>
          Mark all as read
        </Button>
      </div>
      {status === 'loading' && items.length === 0 ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="You're all caught up" />
      ) : (
        <ul className="m-0 max-h-[420px] list-none overflow-y-auto p-0" aria-label="Notifications">
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                data-testid="notification"
                data-read={n.read}
                onClick={() => onPick(n)}
                className="flex w-full cursor-pointer gap-3 rounded-lg border-0 p-2 text-left"
                style={{ background: n.read ? 'transparent' : token.colorPrimaryBg }}
              >
                <span
                  className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{ background: token.colorFillSecondary, color: token.colorPrimary }}
                  aria-hidden
                >
                  {ICONS[n.type]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${n.read ? '' : 'font-semibold'}`}>{n.title}</span>
                  {n.body ? (
                    <span className="block truncate text-xs" style={{ color: token.colorTextSecondary }}>
                      {n.body}
                    </span>
                  ) : null}
                  <span className="block text-xs" style={{ color: token.colorTextTertiary }}>
                    {fromNow(n.createdAt)}
                  </span>
                </span>
                {n.read ? null : <span className="mt-2 h-2 w-2 shrink-0 rounded-full" style={{ background: token.colorPrimary }} aria-label="Unread" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange} trigger="click" placement="bottomRight" content={content} arrow={false}>
      <Button
        type="text"
        shape="circle"
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        icon={
          <Badge count={unreadCount} size="small" overflowCount={99}>
            <BellOutlined style={{ fontSize: 18 }} />
          </Badge>
        }
      />
    </Popover>
  );
}
