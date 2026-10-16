import { CalendarOutlined, EditOutlined, NotificationOutlined, WalletOutlined } from '@ant-design/icons';
import { Button, Space, theme, Typography } from 'antd';
import dayjs from 'dayjs';
import { greeting } from '../../../utils/dates';

interface GreetingProps {
  name: string;
  isAdmin: boolean;
  onApplyLeave: () => void;
  /** Shown when the plan includes Expenses. */
  onNewExpense?: () => void;
  onNewPost: () => void;
  onNewAnnouncement: () => void;
}

/** "Good morning, Nisarg", today's date, and the quick actions. */
export function Greeting({ name, isAdmin, onApplyLeave, onNewExpense, onNewPost, onNewAnnouncement }: GreetingProps) {
  const { token } = theme.useToken();
  const firstName = name.trim().split(/\s+/)[0] ?? name;
  return (
    <div
      className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl p-6"
      style={{
        background: `linear-gradient(120deg, ${token.colorPrimary} 0%, ${token.colorPrimaryActive} 100%)`,
        color: token.colorWhite,
      }}
    >
      <div>
        <Typography.Title level={3} className="!mb-1" style={{ color: token.colorWhite }}>
          {greeting()}, {firstName} 👋
        </Typography.Title>
        <div style={{ opacity: 0.85 }}>{dayjs().format('dddd, D MMMM YYYY')}</div>
      </div>
      <Space wrap>
        <Button icon={<CalendarOutlined />} onClick={onApplyLeave}>
          Apply leave
        </Button>
        {onNewExpense ? (
          <Button icon={<WalletOutlined />} onClick={onNewExpense}>
            New expense
          </Button>
        ) : null}
        <Button icon={<EditOutlined />} onClick={onNewPost}>
          New post
        </Button>
        {isAdmin ? (
          <Button icon={<NotificationOutlined />} onClick={onNewAnnouncement}>
            New announcement
          </Button>
        ) : null}
      </Space>
    </div>
  );
}
