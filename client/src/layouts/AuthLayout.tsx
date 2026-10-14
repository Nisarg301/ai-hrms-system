import { Outlet } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark/BrandMark';
import { tokens } from '../theme/tokens';

export function AuthLayout() {
  return (
    <div className="flex min-h-screen">
      <div
        className="hidden flex-col justify-between p-10 md:flex md:w-[45%]"
        style={{ background: `linear-gradient(155deg, ${tokens.colorPrimaryDeep}, ${tokens.colorPrimary} 65%)` }}
      >
        <BrandMark />
        <div>
          <h1 className="mb-2 text-2xl font-bold" style={{ color: tokens.colorOnDark }}>
            Role-based access,
            <br />
            done right.
          </h1>
          <p className="text-sm" style={{ color: tokens.colorOnDarkMuted }}>
            Manage organizations, roles, and permissions from one secure workspace.
          </p>
        </div>
        <p className="text-xs" style={{ color: tokens.colorOnDarkFooter }}>
          © Sentinel Admin
        </p>
      </div>
      <div className="flex flex-1 items-center justify-center bg-white p-4">
        <div className="w-full max-w-[360px]">
          <div className="mb-6 md:hidden">
            <BrandMark variant="default" />
          </div>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
