import { AppstoreOutlined, BarChartOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { Card, Tabs, Typography } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { CategoriesTab } from './CategoriesTab';
import { ClaimsTab } from './ClaimsTab';
import { SummaryTab } from './SummaryTab';

const TABS = ['claims', 'summary', 'categories'] as const;
type ExpensesTab = (typeof TABS)[number];

/** ORG_ADMIN: everyone's claims (review, pay), what's been spent, and the categories. The tab is in the URL (?tab=summary). */
export default function ExpensesAdminPage() {
  const [params, setParams] = useSearchParams();
  const active: ExpensesTab = TABS.find((t) => t === params.get('tab')) ?? 'claims';
  return (
    <div>
      <Typography.Title level={4}>Expenses</Typography.Title>
      <Card>
        <Tabs
          activeKey={active}
          onChange={(key) => setParams(key === 'claims' ? {} : { tab: key }, { replace: true })}
          destroyOnHidden
          items={[
            { key: 'claims', label: 'Claims', icon: <UnorderedListOutlined />, children: <ClaimsTab /> },
            { key: 'summary', label: 'Summary', icon: <BarChartOutlined />, children: <SummaryTab /> },
            { key: 'categories', label: 'Categories', icon: <AppstoreOutlined />, children: <CategoriesTab /> },
          ]}
        />
      </Card>
    </div>
  );
}
