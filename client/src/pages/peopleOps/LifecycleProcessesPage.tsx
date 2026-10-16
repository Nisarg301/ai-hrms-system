import { PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, message, Progress, Segmented, Table, Tag, theme, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { StartProcessModal } from '../../components/Lifecycle/StartProcessModal';
import { PersonAvatar } from '../../components/PersonAvatar/PersonAvatar';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectLifecycleAdmin } from '../../store/lifecycleAdmin/lifecycleAdminSelectors';
import { closeProcess } from '../../store/lifecycleAdmin/lifecycleAdminSlice';
import { fetchProcesses, openProcess, PROCESS_PAGE_SIZE } from '../../store/lifecycleAdmin/lifecycleAdminThunks';
import { fetchPeople } from '../../store/team/teamThunks';
import type { AdminProcess, LifecycleKind, ProcessStatus } from '../../types/lifecycle';
import { percentFinished, REASON_LABEL, shortDate } from '../../utils/lifecycleFormat';
import { ProcessDrawer } from './ProcessDrawer';

const STATUSES: { value: ProcessStatus; label: string }[] = [
  { value: 'active', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

/**
 * ORG_ADMIN: everyone being onboarded (or offboarded). The status filter and the open
 * process are in the URL (?status=completed&process=…), so a notification can link here.
 */
export default function LifecycleProcessesPage({ kind }: { kind: LifecycleKind }) {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const { processes, processesTotal, processesStatus, processesError } = useAppSelector(selectLifecycleAdmin);
  const [params, setParams] = useSearchParams();
  const status = STATUSES.find((s) => s.value === params.get('status'))?.value ?? 'active';
  const processId = params.get('process');
  const [page, setPage] = useState(1);
  const [starting, setStarting] = useState(false);
  const today = dayjs().format('YYYY-MM-DD');

  const load = () => dispatch(fetchProcesses({ kind, status, page }));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, kind, status, page]);

  // The drawer follows ?process=.
  useEffect(() => {
    if (!processId) {
      dispatch(closeProcess());
      return;
    }
    void dispatch(openProcess(processId)).then((result) => {
      if (openProcess.rejected.match(result)) void message.error(result.payload?.message ?? 'Could not open it');
    });
  }, [dispatch, processId]);
  // The drawer's pickers (reassign, add task) choose from everyone.
  useEffect(() => {
    void dispatch(fetchPeople());
    return () => void dispatch(closeProcess());
  }, [dispatch]);

  const open = (id: string) =>
    setParams((p) => {
      p.set('process', id);
      return p;
    });
  const close = () =>
    setParams((p) => {
      p.delete('process');
      return p;
    });

  const columns: ColumnsType<AdminProcess> = [
    {
      title: 'Person',
      key: 'person',
      render: (_, p) => (
        <span className="flex items-center gap-2">
          <PersonAvatar name={p.employee?.name ?? '?'} avatarUrl={p.employee?.avatarUrl} size="small" />
          <span>
            <span className="block font-medium">{p.employee?.name ?? 'Former member'}</span>
            {p.employee?.jobTitle ? (
              <span className="block text-xs" style={{ color: token.colorTextSecondary }}>
                {p.employee.jobTitle}
              </span>
            ) : null}
          </span>
        </span>
      ),
    },
    {
      title: kind === 'onboarding' ? 'Joining' : 'Last day',
      key: 'anchor',
      render: (_, p) => shortDate(p.anchorDate) + (p.status === 'active' && p.anchorDate === today ? ' (today)' : ''),
    },
    { title: 'Manager', key: 'manager', render: (_, p) => p.manager?.name ?? '—', responsive: ['md'] },
    kind === 'onboarding'
      ? { title: 'Buddy', key: 'buddy', render: (_, p) => p.buddy?.name ?? '—', responsive: ['lg'] }
      : { title: 'Reason', key: 'reason', render: (_, p) => (p.reason ? REASON_LABEL[p.reason] : '—'), responsive: ['lg'] },
    {
      title: 'Progress',
      key: 'progress',
      render: (_, p) => (
        <div className="min-w-[140px]">
          <Progress percent={percentFinished(p.progress)} size="small" showInfo={false} />
          <span className="text-xs" style={{ color: token.colorTextSecondary }}>
            {p.progress.done + p.progress.skipped} of {p.progress.total}
          </span>
          {p.progress.overdue && p.status === 'active' ? (
            <Tag color="red" className="!ml-2">
              {p.progress.overdue} overdue
            </Tag>
          ) : null}
        </div>
      ),
    },
    ...(status !== 'active'
      ? [
          {
            title: status === 'completed' ? 'Completed' : 'Cancelled',
            key: 'ended',
            render: (_: unknown, p: AdminProcess) => {
              const at = status === 'completed' ? p.completedAt : p.cancelledAt;
              return (
                <span>
                  {at ? dayjs(at).format('D MMM YYYY') : '—'}
                  {p.accountDisabled ? <Tag className="!ml-2">Account disabled</Tag> : null}
                </span>
              );
            },
          },
        ]
      : []),
  ];

  const label = kind === 'onboarding' ? 'Onboarding' : 'Offboarding';
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Typography.Title level={4} className="!mb-0">
          {label}
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setStarting(true)}>
          Start {label.toLowerCase()}
        </Button>
      </div>
      <Card>
        <Segmented
          className="mb-4"
          value={status}
          options={STATUSES}
          onChange={(v) => {
            setPage(1);
            setParams((p) => {
              if (v === 'active') p.delete('status');
              else p.set('status', v as string);
              return p;
            });
          }}
        />
        {processesError ? <Alert className="mb-4" type="error" showIcon message={processesError} /> : null}
        <Table<AdminProcess>
          rowKey="id"
          columns={columns}
          dataSource={processes}
          loading={processesStatus === 'loading'}
          scroll={{ x: 800 }}
          onRow={(p) => ({ onClick: () => open(p.id), className: 'cursor-pointer' })}
          pagination={{ current: page, pageSize: PROCESS_PAGE_SIZE, total: processesTotal, hideOnSinglePage: true, showSizeChanger: false, onChange: setPage }}
          locale={{
            emptyText:
              status === 'active' ? (
                <EmptyState
                  title={kind === 'onboarding' ? 'Nobody is being onboarded' : 'Nobody is leaving'}
                  hint={kind === 'onboarding' ? 'Start onboarding here, or when you add an employee.' : 'Start offboarding here, or from the Employees page.'}
                />
              ) : (
                <EmptyState title={`No ${status} ${label.toLowerCase()} yet`} />
              ),
          }}
        />
      </Card>
      <ProcessDrawer onClose={close} onChanged={() => void load()} />
      <StartProcessModal
        kind={kind}
        open={starting}
        onClose={() => setStarting(false)}
        onStarted={(p) => {
          void load();
          open(p.id);
        }}
      />
    </div>
  );
}
