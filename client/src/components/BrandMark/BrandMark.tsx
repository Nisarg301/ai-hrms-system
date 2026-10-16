import { SafetyCertificateOutlined } from '@ant-design/icons';
import { tokens } from '../../theme/tokens';

interface BrandMarkProps {
  /** 'inverse' (white) is for dark backgrounds — the sidebar, the auth brand
   * panel. 'default' (navy) is for light backgrounds. */
  variant?: 'inverse' | 'default';
}

export function BrandMark({ variant = 'inverse' }: BrandMarkProps) {
  const color = variant === 'inverse' ? tokens.colorOnDark : tokens.colorPrimaryDeep;
  return (
    <div className="flex items-center gap-2">
      <SafetyCertificateOutlined style={{ fontSize: 20, color }} />
      <span className="text-base font-semibold" style={{ color }}>
        Sentinel
      </span>
    </div>
  );
}
