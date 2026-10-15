import { Alert, DatePicker, Form, Input, InputNumber, message, Modal, Select } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useAppDispatch } from '../../hooks/store';
import { createGoal, updateGoal } from '../../store/performance/performanceThunks';
import type { GoalDetail } from '../../types/performance';
import type { Person } from '../../types/people';

interface GoalFormModalProps {
  open: boolean;
  /** Editing this goal; null = a new one. */
  goal: GoalDetail | null;
  /** For a new goal: whose it can be (my direct reports); empty = mine. */
  owners?: Person[];
  onClose: () => void;
  onSaved?: (goal: GoalDetail) => void;
}

/** A goal's title, description, dates and weight; progress and status come from check-ins. */
export function GoalFormModal({ open, goal, owners = [], onClose, onSaved }: GoalFormModalProps) {
  const dispatch = useAppDispatch();
  const [ownerId, setOwnerId] = useState<string | undefined>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [weight, setWeight] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setOwnerId(undefined);
    setTitle(goal?.title ?? '');
    setDescription(goal?.description ?? '');
    setStartDate(goal?.startDate ?? dayjs().format('YYYY-MM-DD'));
    setDueDate(goal?.dueDate ?? null);
    setWeight(goal?.weight ?? null);
    setErrors({});
    setServerError(null);
  }, [open, goal]);

  const onOk = async () => {
    const problems: Record<string, string> = {};
    if (owners.length && !goal && !ownerId) problems.ownerId = 'Choose whose goal it is';
    if (!title.trim()) problems.title = 'Give the goal a title';
    if (!startDate) problems.startDate = 'Choose a start date';
    if (!dueDate) problems.dueDate = 'Choose a due date';
    else if (startDate && dueDate < startDate) problems.dueDate = 'The due date can’t be before the start date';
    setErrors(problems);
    if (Object.keys(problems).length) return;

    setSaving(true);
    setServerError(null);
    const payload = { title: title.trim(), description: description.trim(), startDate: startDate!, dueDate: dueDate!, weight };
    const result = goal ? await dispatch(updateGoal({ id: goal.id, payload })) : await dispatch(createGoal({ ...payload, ...(ownerId ? { ownerId } : {}) }));
    setSaving(false);
    if (createGoal.rejected.match(result) || updateGoal.rejected.match(result)) {
      const fieldErrors = (result.payload?.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors ?? {};
      const known = Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, v[0]]));
      setErrors(known);
      if (!Object.keys(known).length) setServerError(result.payload?.message ?? 'Could not save the goal');
      return;
    }
    void message.success(goal ? 'Goal saved' : 'Goal added');
    onSaved?.(result.payload);
    onClose();
  };

  const item = (name: string) => (errors[name] ? { validateStatus: 'error' as const, help: errors[name] } : {});

  return (
    <Modal open={open} title={goal ? 'Edit goal' : owners.length ? 'New goal for your team' : 'New goal'} okText="Save" onOk={onOk} confirmLoading={saving} onCancel={onClose} destroyOnHidden>
      {serverError ? <Alert className="mb-3" type="error" showIcon message={serverError} /> : null}
      <Form layout="vertical">
        {owners.length && !goal ? (
          <Form.Item label="For" htmlFor="goal-owner" {...item('ownerId')}>
            <Select
              id="goal-owner"
              showSearch
              optionFilterProp="label"
              placeholder="Choose a person"
              value={ownerId}
              onChange={setOwnerId}
              options={owners.map((p) => ({ value: p.id, label: p.name }))}
            />
          </Form.Item>
        ) : null}
        <Form.Item label="Goal" htmlFor="goal-title" {...item('title')}>
          <Input id="goal-title" maxLength={120} placeholder="e.g. Launch the new onboarding flow" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Form.Item>
        <Form.Item label="Description (optional)" htmlFor="goal-description" {...item('description')}>
          <Input.TextArea id="goal-description" rows={3} maxLength={2000} placeholder="What does done look like?" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Form.Item>
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-3">
          <Form.Item label="Start" htmlFor="goal-start" {...item('startDate')}>
            <DatePicker
              id="goal-start"
              className="w-full"
              format={['DD MMM YYYY', 'YYYY-MM-DD']}
              allowClear={false}
              value={startDate ? dayjs(startDate) : null}
              onChange={(d) => setStartDate(d ? d.format('YYYY-MM-DD') : null)}
            />
          </Form.Item>
          <Form.Item label="Due" htmlFor="goal-due" {...item('dueDate')}>
            <DatePicker id="goal-due" className="w-full" format={['DD MMM YYYY', 'YYYY-MM-DD']} value={dueDate ? dayjs(dueDate) : null} onChange={(d) => setDueDate(d ? d.format('YYYY-MM-DD') : null)} />
          </Form.Item>
          <Form.Item label="Weight (optional)" htmlFor="goal-weight" {...item('weight')}>
            <InputNumber id="goal-weight" className="w-full" min={1} max={100} precision={0} suffix="%" value={weight} onChange={(v) => setWeight(v ?? null)} />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}
