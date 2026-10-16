import { InboxOutlined } from '@ant-design/icons';
import { tokens } from '../../theme/tokens';

interface EmptyStateProps {
  title: string;
  hint?: string;
}

export function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <InboxOutlined style={{ fontSize: 32, color: tokens.colorBorder }} />
      <div className="font-medium" style={{ color: tokens.colorPrimaryDeep }}>
        {title}
      </div>
      {hint ? (
        <div className="text-sm" style={{ color: tokens.colorStatusNeutralText }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}
