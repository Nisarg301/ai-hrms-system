import { CheckSquareOutlined, DownloadOutlined, FileTextOutlined, ProjectOutlined, SolutionOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Typography, theme } from 'antd';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { MODULE_LABELS } from '../../constants/modules';
import { useCan } from '../../hooks/useCan';
import { EXPORTABLE_MODULES, exportModuleRequest, type ExportableModule } from '../../services/endpoints/exports.endpoints';
import { ApiError } from '../../types/api';
import { filenameFromDisposition, saveBlob } from '../../utils/saveBlob';

const DETAILS: Record<ExportableModule, { icon: ReactNode; columns: string }> = {
  employees: { icon: <SolutionOutlined />, columns: 'Name, email, job title, department, role, status' },
  documents: { icon: <FileTextOutlined />, columns: 'Title, description, category, status, file name' },
  projects: { icon: <ProjectOutlined />, columns: 'Name, description, deadline, status' },
  tasks: { icon: <CheckSquareOutlined />, columns: 'Title, description, due date, status, project, members' },
};

function downloadError(module: ExportableModule, err: unknown): string {
  // With a blob response the server's JSON error body isn't readable, so map the status.
  const label = MODULE_LABELS[module].toLowerCase();
  if (err instanceof ApiError && err.status === 403) return `You don't have permission to export ${label}.`;
  return `Could not download ${label}. Please try again.`;
}

/** Professional plan: CSV downloads of every module the user can read. */
export default function ExportsPage() {
  const can = useCan();
  const { token } = theme.useToken();
  const [busy, setBusy] = useState<ExportableModule | null>(null);
  const [error, setError] = useState<string | null>(null);

  const modules = EXPORTABLE_MODULES.filter((module) => can(module, 'read'));

  const download = async (module: ExportableModule) => {
    setError(null);
    setBusy(module);
    try {
      const response = await exportModuleRequest(module);
      const fallback = `${module}-${new Date().toISOString().slice(0, 10)}.csv`;
      saveBlob(response.data, filenameFromDisposition(response.headers['content-disposition'], fallback));
    } catch (err) {
      setError(downloadError(module, err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="mb-4 pb-4" style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        <Typography.Title level={4} className="!mb-1">
          Exports
        </Typography.Title>
        <Typography.Text type="secondary">
          Download all of your organization's current records as CSV (opens in Excel or Google Sheets).
        </Typography.Text>
      </div>

      {error ? <Alert className="mb-4" type="error" message={error} showIcon closable onClose={() => setError(null)} /> : null}

      {modules.length === 0 ? (
        <EmptyState title="Nothing to export" hint="Your role can't read any of the exportable modules." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {modules.map((module) => (
            <Card key={module} data-testid={`export-${module}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-3">
                  <span className="text-xl" style={{ color: token.colorPrimary }}>
                    {DETAILS[module].icon}
                  </span>
                  <div>
                    <Typography.Text strong>{MODULE_LABELS[module]}</Typography.Text>
                    <div>
                      <Typography.Text type="secondary" className="text-sm">
                        {DETAILS[module].columns}
                      </Typography.Text>
                    </div>
                  </div>
                </div>
                <Button
                  icon={<DownloadOutlined />}
                  loading={busy === module}
                  disabled={busy !== null && busy !== module}
                  onClick={() => void download(module)}
                  aria-label={`Download ${MODULE_LABELS[module]} CSV`}
                >
                  CSV
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
