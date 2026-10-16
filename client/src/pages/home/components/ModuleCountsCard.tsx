import { AppstoreOutlined, CheckSquareOutlined, FileTextOutlined, ProjectOutlined, SolutionOutlined } from '@ant-design/icons';
import { Col, Row, Statistic } from 'antd';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../../../constants/routes';
import { useCan } from '../../../hooks/useCan';
import type { ModuleCounts } from '../../../types/home';
import type { ModuleName } from '../../../types/role';
import { HomeCard } from './HomeCard';

interface CountConfig {
  module: ModuleName;
  label: string;
  icon: ReactNode;
  to: string;
  value: number | null;
}

/** The old Dashboard's counts, for users who can read the dashboard; hidden otherwise. */
export function ModuleCountsCard({ counts }: { counts: ModuleCounts | null }) {
  const navigate = useNavigate();
  const can = useCan();
  if (!counts) return null;

  const items: CountConfig[] = [
    { module: 'employees', label: 'Employees', icon: <SolutionOutlined />, to: ROUTES.employees, value: counts.employees },
    { module: 'documents', label: 'Documents', icon: <FileTextOutlined />, to: ROUTES.documents, value: counts.documents },
    { module: 'projects', label: 'Projects', icon: <ProjectOutlined />, to: ROUTES.projects, value: counts.projects },
    { module: 'tasks', label: 'Tasks', icon: <CheckSquareOutlined />, to: ROUTES.tasks, value: counts.tasks },
  ];
  const visible = items.filter((c) => c.value !== null && can(c.module, 'read'));
  if (visible.length === 0) return null;

  return (
    <HomeCard title="At a glance" icon={<AppstoreOutlined />}>
      <Row gutter={[12, 12]}>
        {visible.map((c) => (
          <Col key={c.module} span={12}>
            <button
              type="button"
              className="w-full cursor-pointer rounded-lg border-0 bg-transparent p-0 text-left"
              aria-label={`${c.label}: ${c.value}`}
              onClick={() => navigate(c.to)}
            >
              <Statistic title={c.label} value={c.value ?? 0} prefix={c.icon} />
            </button>
          </Col>
        ))}
      </Row>
    </HomeCard>
  );
}
