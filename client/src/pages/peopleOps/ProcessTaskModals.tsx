import { Alert, DatePicker, Form, Input, message, Modal, Select } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { addProcessTask, skipProcessTask, updateProcessTask } from '../../store/lifecycleAdmin/lifecycleAdminThunks';
import { selectPeople } from '../../store/team/teamSelectors';
import type { ChecklistTaskType, LifecycleTask } from '../../types/lifecycle';
import type { FieldAwareError } from '../../store/thunkError';

/** Value used in assignee pickers for "any admin" (sent as null). */
export const ADMINS = '__admins__';

const TYPE_OPTIONS: { value: ChecklistTaskType; label: string }[] = [
  { value: 'task', label: 'Task (mark as done)' },
  { value: 'upload', label: 'Upload a file' },
  { value: 'acknowledge', label: 'Read & confirm' },
  { value: 'form', label: 'Form (questions)' },
];

function firstError(payload: FieldAwareError | undefined, fallback: string): string {
  const fieldErrors = (payload?.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors;
  return fieldErrors ? Object.values(fieldErrors)[0][0] : (payload?.message ?? fallback);
}

export function useAssigneeOptions() {
  const people = useAppSelector(selectPeople);
  return [{ value: ADMINS, label: 'Admins (any of them)' }, ...people.map((p) => ({ value: p.id, label: p.jobTitle ? `${p.name} · ${p.jobTitle}` : p.name }))];
}

export type TaskAction = { mode: 'reassign' | 'due' | 'skip'; task: LifecycleTask } | null;

/** Reassign, move or skip one pending task. */
export function TaskActionModal({ action, onClose }: { action: TaskAction; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const assignees = useAssigneeOptions();
  const [assignee, setAssignee] = useState<string>(ADMINS);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!action) return;
    setAssignee(action.task.assigneeId ?? ADMINS);
    setDueDate(action.task.dueDate);
    setReason('');
    setError(null);
  }, [action]);

  if (!action) return null;
  const { mode, task } = action;

  const onOk = async () => {
    if (mode === 'skip' && !reason.trim()) {
      setError('Say why it’s being skipped');
      return;
    }
    setSaving(true);
    setError(null);
    const result =
      mode === 'skip'
        ? await dispatch(skipProcessTask({ taskId: task.id, reason: reason.trim() }))
        : await dispatch(
            updateProcessTask({
              taskId: task.id,
              payload: mode === 'reassign' ? { assigneeId: assignee === ADMINS ? null : assignee } : { dueDate: dueDate! },
            })
          );
    setSaving(false);
    if (skipProcessTask.rejected.match(result) || updateProcessTask.rejected.match(result)) {
      setError(firstError(result.payload, 'Could not save'));
      return;
    }
    void message.success(mode === 'skip' ? `Skipped: ${task.title}` : `Updated: ${task.title}`);
    onClose();
  };

  const title = mode === 'reassign' ? 'Reassign task' : mode === 'due' ? 'Change due date' : 'Skip task';
  return (
    <Modal open title={title} okText={mode === 'skip' ? 'Skip task' : 'Save'} okButtonProps={{ danger: mode === 'skip' }} confirmLoading={saving} onOk={onOk} onCancel={onClose} destroyOnHidden>
      <p className="font-medium">{task.title}</p>
      {error ? <Alert className="mb-3" type="error" showIcon message={error} /> : null}
      <Form layout="vertical">
        {mode === 'reassign' ? (
          <Form.Item label="Who does it" htmlFor="ta-assignee" extra="They'll be told about it.">
            <Select id="ta-assignee" showSearch optionFilterProp="label" value={assignee} onChange={setAssignee} options={assignees} />
          </Form.Item>
        ) : null}
        {mode === 'due' ? (
          <Form.Item label="Due date" htmlFor="ta-due">
            <DatePicker
              id="ta-due"
              className="w-full"
              format={['DD MMM YYYY', 'YYYY-MM-DD']}
              allowClear={false}
              value={dueDate ? dayjs(dueDate) : null}
              onChange={(d) => d && setDueDate(d.format('YYYY-MM-DD'))}
            />
          </Form.Item>
        ) : null}
        {mode === 'skip' ? (
          <Form.Item label="Why skip it?" htmlFor="ta-reason">
            <Input.TextArea id="ta-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Form.Item>
        ) : null}
      </Form>
    </Modal>
  );
}

/** A one-off task for this process only. */
export function AddTaskModal({ processId, open, onClose }: { processId: string; open: boolean; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const assignees = useAssigneeOptions();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ChecklistTaskType>('task');
  const [questions, setQuestions] = useState('');
  const [instructions, setInstructions] = useState('');
  const [assignee, setAssignee] = useState<string>(ADMINS);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setType('task');
    setQuestions('');
    setInstructions('');
    setAssignee(ADMINS);
    setDueDate(dayjs().format('YYYY-MM-DD'));
    setError(null);
  }, [open]);

  const questionList = questions
    .split('\n')
    .map((q) => q.trim())
    .filter(Boolean);

  const onOk = async () => {
    const problem = !title.trim()
      ? 'Give the task a title'
      : type === 'form' && !questionList.length
        ? 'A form needs at least one question'
        : !dueDate
          ? 'Choose a due date'
          : null;
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await dispatch(
      addProcessTask({
        processId,
        payload: { title: title.trim(), type, questions: type === 'form' ? questionList : [], instructions: instructions.trim(), link: null, assigneeId: assignee === ADMINS ? null : assignee, dueDate: dueDate! },
      })
    );
    setSaving(false);
    if (addProcessTask.rejected.match(result)) {
      setError(firstError(result.payload, 'Could not add the task'));
      return;
    }
    void message.success(`Added: ${title.trim()}`);
    onClose();
  };

  return (
    <Modal open={open} title="Add a task" okText="Add task" confirmLoading={saving} onOk={onOk} onCancel={onClose} destroyOnHidden>
      {error ? <Alert className="mb-3" type="error" showIcon message={error} /> : null}
      <Form layout="vertical">
        <Form.Item label="Task" htmlFor="at-title">
          <Input id="at-title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Form.Item>
        <Form.Item label="Type" htmlFor="at-type">
          <Select id="at-type" value={type} onChange={setType} options={TYPE_OPTIONS} />
        </Form.Item>
        {type === 'form' ? (
          <Form.Item label="Questions (one per line)" htmlFor="at-questions">
            <Input.TextArea id="at-questions" rows={3} value={questions} onChange={(e) => setQuestions(e.target.value)} />
          </Form.Item>
        ) : null}
        <Form.Item label="Instructions (optional)" htmlFor="at-instructions">
          <Input.TextArea id="at-instructions" rows={2} maxLength={1000} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </Form.Item>
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
          <Form.Item label="Who does it" htmlFor="at-assignee">
            <Select id="at-assignee" showSearch optionFilterProp="label" value={assignee} onChange={setAssignee} options={assignees} />
          </Form.Item>
          <Form.Item label="Due date" htmlFor="at-due">
            <DatePicker
              id="at-due"
              className="w-full"
              format={['DD MMM YYYY', 'YYYY-MM-DD']}
              allowClear={false}
              value={dueDate ? dayjs(dueDate) : null}
              onChange={(d) => d && setDueDate(d.format('YYYY-MM-DD'))}
            />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}
