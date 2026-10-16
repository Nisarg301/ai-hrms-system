import { Card, theme } from 'antd';
import type { ReactNode } from 'react';

interface HomeCardProps {
  title: string;
  icon: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}

/** The Home page's card: a small tinted icon badge next to the title. */
export function HomeCard({ title, icon, extra, children }: HomeCardProps) {
  const { token } = theme.useToken();
  return (
    <Card
      className="mb-4"
      styles={{ header: { borderBottom: `1px solid ${token.colorBorderSecondary}` } }}
      title={
        <span className="flex items-center gap-2">
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: token.colorPrimaryBg, color: token.colorPrimary }}
            aria-hidden
          >
            {icon}
          </span>
          {title}
        </span>
      }
      extra={extra}
    >
      {children}
    </Card>
  );
}

/** Friendly one-liner for an empty card. */
export function EmptyNote({ children }: { children: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <div className="py-2 text-center text-sm" style={{ color: token.colorTextSecondary }}>
      {children}
    </div>
  );
}
