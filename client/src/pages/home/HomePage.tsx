import { HomeOutlined, SmileOutlined } from '@ant-design/icons';
import { Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { DashboardTab } from './DashboardTab';
import { WelcomeTab } from './WelcomeTab';

type HomeTab = 'dashboard' | 'welcome';

/** Every member's landing page. The tab lives in the URL (?tab=welcome) so it survives a reload or a shared link. */
export default function HomePage() {
  const [params, setParams] = useSearchParams();
  const active: HomeTab = params.get('tab') === 'welcome' ? 'welcome' : 'dashboard';

  return (
    <Tabs
      activeKey={active}
      onChange={(key) => setParams(key === 'welcome' ? { tab: 'welcome' } : {}, { replace: true })}
      destroyOnHidden
      items={[
        {
          key: 'dashboard',
          label: 'Dashboard',
          icon: <HomeOutlined />,
          children: <DashboardTab />,
        },
        {
          key: 'welcome',
          label: 'Welcome',
          icon: <SmileOutlined />,
          children: <WelcomeTab />,
        },
      ]}
    />
  );
}
