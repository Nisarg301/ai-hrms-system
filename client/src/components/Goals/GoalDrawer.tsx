import { DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Drawer, Empty, Input, InputNumber, message, Progress, Select, Slider, Space, Tag, theme, Timeline, Typography } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { confirmAction } from '../ConfirmDialog/confirmDialog';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectPerformance } from '../../store/performance/performanceSelectors';
import { closeGoal } from '../../store/performance/performanceSlice';
import { checkInGoal, deleteGoal } from '../../store/performance/performanceThunks';
import type { GoalCheckIn, GoalStatus } from '../../types/performance';
import { GOAL_STATUS_META, GOAL_STATUS_OPTIONS } from '../../utils/performanceFormat';
import { GoalFormModal } from './GoalFormModal';

function change(c: GoalCheckIn): string {
  const parts = [c.previousProgress !== c.progress ? `${c.previousProgress}% → ${c.progress}%` : `${c.progress}%`];
  if (c.previousStatus !== c.status) parts.push(`${GOAL_STATUS_META[c.previousStatus].label} → ${GOAL_STATUS_META[c.status].label}`);
  return parts.join(' · ');
}

/**
 * One goal: its details, a check-in (progress, status, comment) and the history of
 * check-ins. Cancelling is a check-in with status Cancelled; a later one reopens it.
 */
export function GoalDrawer() {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const { current: goal } = useAppSelector(selectPerformance);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<GoalStatus>('on_track');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const goalId = goal?.id;
  const checkInCount = goal?.checkInCount;
  useEffect(() => {
    if (!goal) return;
    setProgress(goal.progress);
    setStatus(goal.status === 'cancelled' ? 'on_track' : goal.status);
    setComment('');
    setError(null);
    // A new goal, or a new check-in saved: start again from where it stands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId, checkInCount]);

  if (!goal) return <Drawer open={false} />;
  const meta = GOAL_STATUS_META[goal.status];
  const mine = goal.relation === 'owner';

  const onCheckIn = async () => {
    setSaving(true);
    setError(null);
    const result = await dispatch(checkInGoal({ id: goal.id, payload: { progress, status, comment: comment.trim() } }));
    setSaving(false);
    if (checkInGoal.rejected.match(result)) {
      const fieldErrors = (result.payload?.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors;
      setError(fieldErrors ? Object.values(fieldErrors)[0][0] : (result.payload?.message ?? 'Could not save the check-in'));
      return;
    }
    void message.success(status === 'cancelled' ? 'Goal cancelled' : 'Checked in');
  };

  const onDelete = () =>
    confirmAction({
      title: `Delete “${goal.title}”?`,
      content: 'Nothing has been recorded against it yet, so it’s removed completely.',
      okText: 'Delete',
      onConfirm: async () => {
        const result = await dispatch(deleteGoal(goal.id));
        if (deleteGoal.rejected.match(result)) void message.error(result.payload ?? 'Could not delete the goal');
        else void message.success('Goal deleted');
      },
    });

  return (
    <Drawer
      open
      width={620}
      onClose={() => dispatch(closeGoal())}
      destroyOnHidden
      title={
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span>{goal.title}</span>
            <Tag color={meta.color} className="!mr-0">
              {meta.label}
            </Tag>
            {goal.overdue ? <Tag color="red">Overdue</Tag> : null}
          </div>
          {!mine ? (
            <div className="text-xs font-normal" style={{ color: token.colorTextSecondary }}>
              {goal.owner?.name ?? 'Someone'}’s goal
            </div>
          ) : null}
        </div>
      }
      extra={
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(true)}>
            Edit
          </Button>
          {goal.canDelete ? (
            <Button size="small" danger icon={<DeleteOutlined />} onClick={onDelete} aria-label="Delete goal">
              Delete
            </Button>
          ) : null}
        </Space>
      }
    >
      <Progress percent={goal.progress} status={goal.status === 'behind' ? 'exception' : undefined} />
      {goal.description ? <Typography.Paragraph className="mt-2" style={{ whiteSpace: 'pre-wrap' }}>{goal.description}</Typography.Paragraph> : null}
      <Descriptions size="small" column={{ xs: 1, sm: 2 }} className="mb-4 mt-2">
        <Descriptions.Item label="Start">{dayjs(goal.startDate).format('D MMM YYYY')}</Descriptions.Item>
        <Descriptions.Item label="Due">{dayjs(goal.dueDate).format('D MMM YYYY')}</Descriptions.Item>
        <Descriptions.Item label="Weight">{goal.weight !== null ? `${goal.weight}%` : '—'}</Descriptions.Item>
        <Descriptions.Item label="Set by">{goal.createdByName ?? '—'}</Descriptions.Item>
      </Descriptions>

      <Card size="small" title="Check in" className="mb-4">
        {error ? <Alert className="mb-3" type="error" showIcon message={error} /> : null}
        <label htmlFor="goal-progress" className="mb-1 block">
          Progress
        </label>
        <div className="flex items-center gap-3">
          <Slider className="flex-1" min={0} max={100} step={5} value={progress} onChange={setProgress} tooltip={{ formatter: (v) => `${v}%` }} />
          <InputNumber id="goal-progress" min={0} max={100} precision={0} suffix="%" value={progress} onChange={(v) => setProgress(v ?? 0)} />
        </div>
        {progress === 100 && status !== 'completed' ? (
          <div className="mb-2 text-sm">
            At 100%.{' '}
            <Button type="link" size="small" className="!p-0" onClick={() => setStatus('completed')}>
              Mark it completed?
            </Button>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="goal-status" className="mb-1 block">
              Status
            </label>
            <Select id="goal-status" className="w-full" value={status} onChange={setStatus} options={GOAL_STATUS_OPTIONS} />
          </div>
          <div>
            <label htmlFor="goal-comment" className="mb-1 block">
              Comment (optional)
            </label>
            <Input.TextArea id="goal-comment" rows={1} autoSize={{ minRows: 1, maxRows: 4 }} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        </div>
        {status === 'cancelled' ? <div className="mt-2 text-xs" style={{ color: token.colorTextSecondary }}>Cancelling keeps the goal and its history; a later check-in reopens it.</div> : null}
        <div className="mt-3 flex justify-end">
          <Button type="primary" loading={saving} danger={status === 'cancelled'} onClick={onCheckIn}>
            {status === 'cancelled' ? 'Cancel goal' : 'Check in'}
          </Button>
        </div>
      </Card>

      <Typography.Title level={5}>History</Typography.Title>
      {goal.checkIns.length ? (
        <Timeline
          items={goal.checkIns.map((c) => ({
            color: GOAL_STATUS_META[c.status].color === 'default' ? 'gray' : GOAL_STATUS_META[c.status].color,
            children: (
              <div data-testid="check-in">
                <div>
                  <strong>{c.authorName}</strong> · {change(c)}
                </div>
                {c.comment ? <div style={{ whiteSpace: 'pre-wrap' }}>“{c.comment}”</div> : null}
                <div className="text-xs" style={{ color: token.colorTextSecondary }}>
                  {dayjs(c.createdAt).format('D MMM YYYY, HH:mm')}
                </div>
              </div>
            ),
          }))}
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No check-ins yet" />
      )}

      <GoalFormModal open={editing} goal={goal} onClose={() => setEditing(false)} />
    </Drawer>
  );
}
