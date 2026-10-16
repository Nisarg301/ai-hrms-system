import { CheckOutlined, DownOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { Alert, Button, Descriptions, Drawer, Dropdown, Input, message, Modal, Progress, Space, Table, Tag, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useState } from 'react';
import { LifecycleTaskDrawer } from '../../components/Lifecycle/LifecycleTaskDrawer';
import { PersonAvatar } from '../../components/PersonAvatar/PersonAvatar';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectLifecycleAdmin } from '../../store/lifecycleAdmin/lifecycleAdminSelectors';
import { cancelProcess, completeProcess, openProcess } from '../../store/lifecycleAdmin/lifecycleAdminThunks';
import type { LifecycleTask, ProcessDetail } from '../../types/lifecycle';
import type { Person } from '../../types/people';
import { assigneeText, dueText, KIND_LABEL, percentFinished, REASON_LABEL, shortDate, TASK_TYPE_LABEL } from '../../utils/lifecycleFormat';
import { AddTaskModal, TaskActionModal, type TaskAction } from './ProcessTaskModals';

const STATUS_TAG = { active: { color: 'blue', label: 'In progress' }, completed: { color: 'green', label: 'Completed' }, cancelled: { color: 'default', label: 'Cancelled' } } as const;

function PersonCell({ person }: { person: Person | null }) {
  if (!person) return <span className="opacity-60">—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <PersonAvatar name={person.name} avatarUrl={person.avatarUrl} size="small" />
      {person.name}
    </span>
  );
}

/** Complete (skipping what's left, and for offboarding disabling the account) or cancel. */
function FinishModal({ process, mode, onClose }: { process: ProcessDetail; mode: 'complete' | 'cancel' | null; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!mode) return null;
  const name = process.employee?.name ?? 'this person';
  const kind = KIND_LABEL[process.kind].toLowerCase();
  const pending = process.progress.pending;

  const onOk = async () => {
    if (mode === 'cancel' && !reason.trim()) {
      setError('Say why it’s being cancelled');
      return;
    }
    setSaving(true);
    setError(null);
    const result =
      mode === 'complete'
        ? await dispatch(completeProcess({ id: process.id, skipRemaining: pending > 0 }))
        : await dispatch(cancelProcess({ id: process.id, reason: reason.trim() }));
    setSaving(false);
    if (completeProcess.rejected.match(result) || cancelProcess.rejected.match(result)) {
      // e.g. "Reassign Mia Shah's direct reports to another manager first".
      setError(result.payload?.message ?? 'Could not save');
      return;
    }
    void message.success(
      mode === 'cancel'
        ? `Cancelled ${name}'s ${kind}`
        : result.payload.accountDisabled
          ? `Completed ${name}'s offboarding. Their account is disabled.`
          : `Completed ${name}'s ${kind}`
    );
    setReason('');
    onClose();
  };

  return (
    <Modal
      open
      title={mode === 'complete' ? `Complete ${kind}?` : `Cancel ${kind}?`}
      okText={mode === 'complete' ? (pending ? `Skip ${pending} and complete` : 'Complete') : `Cancel ${kind}`}
      okButtonProps={{ danger: mode === 'cancel' || process.kind === 'offboarding' }}
      cancelText="Back"
      confirmLoading={saving}
      onOk={onOk}
      onCancel={() => {
        setReason('');
        setError(null);
        onClose();
      }}
    >
      {error ? <Alert className="mb-3" type="error" showIcon message={error} /> : null}
      {mode === 'complete' ? (
        <div className="flex flex-col gap-2">
          {pending ? (
            <Alert type="warning" showIcon message={`${pending} task${pending === 1 ? ' is' : 's are'} still pending. ${pending === 1 ? 'It' : 'They'} will be skipped.`} />
          ) : null}
          {process.kind === 'offboarding' ? (
            <Alert type="error" showIcon message={`This disables ${name}'s account. They won't be able to log in.`} description="You can turn it back on by editing the employee." />
          ) : (
            <div>All of {name}'s onboarding tasks are finished.</div>
          )}
        </div>
      ) : (
        <>
          <p>
            {process.kind === 'onboarding' ? `${name} stays in your organization; remove them separately if they won't join.` : `${name} stays active.`} Pending tasks are skipped.
          </p>
          <label htmlFor="pd-cancel-reason" className="mb-1 block">
            Why? (only admins see this)
          </label>
          <Input.TextArea id="pd-cancel-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </>
      )}
    </Modal>
  );
}

/** One process for ORG_ADMIN: who, when, every task, and what can be done about them. */
export function ProcessDrawer({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const { current: process } = useAppSelector(selectLifecycleAdmin);
  const [action, setAction] = useState<TaskAction>(null);
  const [adding, setAdding] = useState(false);
  const [finishing, setFinishing] = useState<'complete' | 'cancel' | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  if (!process) return <Drawer open={false} />;
  const active = process.status === 'active';
  const today = dayjs().format('YYYY-MM-DD');
  const name = process.employee?.name ?? 'Former member';
  const { progress } = process;
  const openTask = process.tasks.find((t) => t.id === openTaskId) ?? null;

  const columns: ColumnsType<LifecycleTask> = [
    {
      title: 'Task',
      key: 'title',
      render: (_, t) => (
        <div>
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-left font-medium" style={{ color: token.colorLink }} onClick={() => setOpenTaskId(t.id)}>
            {t.title}
          </button>
          <div className="mt-1 flex flex-wrap gap-1">
            {TASK_TYPE_LABEL[t.type] ? <Tag className="!mr-0">{TASK_TYPE_LABEL[t.type]}</Tag> : null}
            {t.adHoc ? <Tag className="!mr-0">Added</Tag> : null}
          </div>
        </div>
      ),
    },
    { title: 'Who', key: 'who', render: (_, t) => assigneeText(t) },
    {
      title: 'Due',
      key: 'due',
      render: (_, t) => (
        <span style={{ color: t.overdue ? token.colorError : undefined }}>
          {shortDate(t.dueDate)}
          {t.overdue ? ' · overdue' : ''}
        </span>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, t) => (
        <Tag color={t.status === 'done' ? 'green' : t.status === 'skipped' ? 'default' : t.overdue ? 'red' : 'gold'} className="!mr-0" title={t.skipReason || undefined}>
          {t.status === 'pending' ? 'Pending' : dueText(t, today)}
        </Tag>
      ),
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_, t) =>
        active && t.status === 'pending' ? (
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'open', label: 'Open / complete' },
                { key: 'reassign', label: 'Reassign…' },
                { key: 'due', label: 'Change due date…' },
                { key: 'skip', label: 'Skip…', danger: true },
              ],
              onClick: ({ key }) => (key === 'open' ? setOpenTaskId(t.id) : setAction({ mode: key as 'reassign' | 'due' | 'skip', task: t })),
            }}
          >
            <Button size="small" aria-label={`Actions for ${t.title}`}>
              Actions <DownOutlined />
            </Button>
          </Dropdown>
        ) : null,
    },
  ];

  return (
    <Drawer
      open
      width={880}
      onClose={onClose}
      destroyOnHidden
      title={
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {name}'s {KIND_LABEL[process.kind].toLowerCase()}
          </span>
          <Tag color={STATUS_TAG[process.status].color} className="!mr-0">
            {STATUS_TAG[process.status].label}
          </Tag>
        </div>
      }
      footer={
        active ? (
          <div className="flex flex-wrap justify-between gap-2">
            <Button icon={<StopOutlined />} onClick={() => setFinishing('cancel')}>
              Cancel {KIND_LABEL[process.kind].toLowerCase()}
            </Button>
            <Button type="primary" icon={<CheckOutlined />} onClick={() => setFinishing('complete')}>
              Complete
            </Button>
          </div>
        ) : null
      }
    >
      <Descriptions size="small" column={{ xs: 1, sm: 2 }} className="mb-4">
        <Descriptions.Item label={process.kind === 'onboarding' ? 'Joining date' : 'Last working day'}>{dayjs(process.anchorDate).format('ddd, D MMM YYYY')}</Descriptions.Item>
        <Descriptions.Item label="Template">{process.templateName}</Descriptions.Item>
        <Descriptions.Item label="Manager">
          <PersonCell person={process.manager} />
        </Descriptions.Item>
        {process.kind === 'onboarding' ? (
          <Descriptions.Item label="Buddy">
            <PersonCell person={process.buddy} />
          </Descriptions.Item>
        ) : (
          <Descriptions.Item label="Reason">{process.reason ? REASON_LABEL[process.reason] : '—'}</Descriptions.Item>
        )}
        <Descriptions.Item label="Started">
          {dayjs(process.startedAt).format('D MMM YYYY')}
          {process.startedByName ? ` by ${process.startedByName}` : ''}
        </Descriptions.Item>
        {process.completedAt ? (
          <Descriptions.Item label="Completed">
            {dayjs(process.completedAt).format('D MMM YYYY')}
            {process.completedByName ? ` by ${process.completedByName}` : ''}
            {process.accountDisabled ? ' · account disabled' : ''}
          </Descriptions.Item>
        ) : null}
        {process.cancelledAt ? <Descriptions.Item label="Cancelled">{`${dayjs(process.cancelledAt).format('D MMM YYYY')}: ${process.cancelledReason ?? ''}`}</Descriptions.Item> : null}
      </Descriptions>
      {process.kind === 'offboarding' && process.adminNotes ? <Alert className="mb-4" type="info" message="Notes (admins only)" description={process.adminNotes} /> : null}
      {active && process.kind === 'offboarding' && process.anchorDate < today ? (
        <Alert className="mb-4" type="warning" showIcon message={`${name}'s last day has passed. Their account stays active until you complete the offboarding.`} />
      ) : null}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-[220px] flex-1" data-testid="process-progress">
          <Progress percent={percentFinished(progress)} size="small" />
          <div className="text-xs" style={{ color: token.colorTextSecondary }}>
            {progress.done} done · {progress.skipped} skipped · {progress.pending} pending
            {progress.overdue ? ` · ${progress.overdue} overdue` : ''}
          </div>
        </div>
        {active ? (
          <Space>
            <Button icon={<PlusOutlined />} onClick={() => setAdding(true)}>
              Add task
            </Button>
          </Space>
        ) : null}
      </div>
      <Table<LifecycleTask> rowKey="id" size="small" columns={columns} dataSource={process.tasks} pagination={false} scroll={{ x: 720 }} />

      <TaskActionModal action={action} onClose={() => setAction(null)} />
      <AddTaskModal processId={process.id} open={adding} onClose={() => setAdding(false)} />
      <FinishModal
        process={process}
        mode={finishing}
        onClose={() => {
          setFinishing(null);
          onChanged();
        }}
      />
      <LifecycleTaskDrawer
        task={openTask}
        whose={`${name}'s ${process.kind}`}
        today={today}
        onClose={() => setOpenTaskId(null)}
        onDone={() => {
          // Progress counts every task, so ask again rather than guess.
          void dispatch(openProcess(process.id));
          onChanged();
        }}
      />
    </Drawer>
  );
}
