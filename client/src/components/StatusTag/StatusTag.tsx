import { Tag } from 'antd';
import { tokens } from '../../theme/tokens';

type StatusValue = 'active' | 'inactive' | 'disabled' | 'archived' | 'planning' | 'completed' | 'on-hold' | 'todo' | 'in-progress' | 'done' | 'blocked';

interface StatusTagProps {
  status: StatusValue;
}

/**
 * "disabled" is an administrative state, not an error, so it gets the
 * neutral-gray tint rather than AntD's default red.
 */
export function StatusTag({ status }: StatusTagProps) {
  return (
    <Tag
      style={{
        background: status === 'active' ? tokens.colorStatusActiveBg : tokens.colorStatusNeutralBg,
        color: status === 'active' ? tokens.colorStatusActiveText : tokens.colorStatusNeutralText,
        border: 'none',
      }}
    >
      {status}
    </Tag>
  );
}
