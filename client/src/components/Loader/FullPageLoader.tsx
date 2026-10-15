import { Spin } from 'antd';

export function FullPageLoader() {
  return (
    <div className="flex h-full min-h-screen w-full items-center justify-center" role="status" aria-label="Loading">
      <Spin size="large" />
    </div>
  );
}
