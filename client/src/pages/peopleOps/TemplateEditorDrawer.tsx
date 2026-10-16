import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Drawer, Form, Input, InputNumber, message, Select, Space, theme, Tooltip } from 'antd';
import { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { saveTemplate } from '../../store/lifecycleAdmin/lifecycleAdminThunks';
import { selectPeople } from '../../store/team/teamSelectors';
import { fetchPeople } from '../../store/team/teamThunks';
import type { AssigneeKind, ChecklistTaskType, ChecklistTemplate, LifecycleKind, TemplateTask } from '../../types/lifecycle';
import { offsetText } from '../../utils/lifecycleFormat';

const MAX_TASKS = 40;
const MAX_QUESTIONS = 10;
const MIN_OFFSET = -90;
const MAX_OFFSET = 180;

/** A task being edited; `uid` keeps React rows stable while tasks move. */
type Draft = TemplateTask & { uid: string };

let nextUid = 0;
const uid = () => `draft-${(nextUid += 1)}`;

const TYPE_OPTIONS: { value: ChecklistTaskType; label: string }[] = [
  { value: 'task', label: 'Task (mark as done)' },
  { value: 'upload', label: 'Upload a file' },
  { value: 'acknowledge', label: 'Read & confirm' },
  { value: 'form', label: 'Form (questions)' },
];

function assigneeOptions(kind: LifecycleKind): { value: AssigneeKind; label: string }[] {
  return [
    { value: 'employee', label: kind === 'onboarding' ? 'The new joiner' : 'The person leaving' },
    { value: 'manager', label: 'Their manager' },
    ...(kind === 'onboarding' ? [{ value: 'buddy' as const, label: 'Their buddy' }] : []),
    { value: 'admin', label: 'Admins (any of them)' },
    { value: 'person', label: 'A specific person' },
  ];
}

const blankTask = (): Draft => ({ uid: uid(), title: '', instructions: '', assignee: { kind: 'admin', userId: null }, dueOffsetDays: 0, type: 'task', questions: [], link: null });

const isLink = (v: string) => (v.startsWith('/') && !v.startsWith('//')) || /^https?:\/\/\S+$/i.test(v);

/** The server's rules, checked here first: the first problem with each task, by position. */
function problemsOf(name: string, tasks: Draft[]): { name?: string; tasks: Record<number, string>; list?: string } {
  const out: { name?: string; tasks: Record<number, string>; list?: string } = { tasks: {} };
  if (!name.trim()) out.name = 'Name is required';
  if (!tasks.length) out.list = 'Add at least one task';
  tasks.forEach((t, i) => {
    const problem = !t.title.trim()
      ? 'Give the task a title'
      : t.assignee.kind === 'person' && !t.assignee.userId
        ? 'Choose the person'
        : !Number.isInteger(t.dueOffsetDays) || t.dueOffsetDays < MIN_OFFSET || t.dueOffsetDays > MAX_OFFSET
          ? `Due between ${-MIN_OFFSET} days before and ${MAX_OFFSET} days after`
          : t.type === 'form' && !t.questions.some((q) => q.trim())
            ? 'A form needs at least one question'
            : t.link && !isLink(t.link.trim())
              ? 'Use an app path (/…) or an http(s) link'
              : null;
    if (problem) out.tasks[i] = problem;
  });
  return out;
}

interface TemplateEditorDrawerProps {
  open: boolean;
  kind: LifecycleKind;
  /** null = a new template. */
  template: ChecklistTemplate | null;
  onClose: () => void;
}

export function TemplateEditorDrawer({ open, kind, template, onClose }: TemplateEditorDrawerProps) {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const people = useAppSelector(selectPeople);
  const [name, setName] = useState('');
  const [tasks, setTasks] = useState<Draft[]>([]);
  const [problems, setProblems] = useState<ReturnType<typeof problemsOf>>({ tasks: {} });
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    void dispatch(fetchPeople());
    setName(template?.name ?? '');
    setTasks(template ? template.tasks.map((t) => ({ ...t, uid: uid() })) : [blankTask()]);
    setProblems({ tasks: {} });
    setServerErrors([]);
  }, [open, template, dispatch]);

  const change = (i: number, patch: Partial<Draft>) => setTasks((all) => all.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const move = (i: number, by: -1 | 1) =>
    setTasks((all) => {
      const next = [...all];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });

  const onSave = async () => {
    const found = problemsOf(name, tasks);
    setProblems(found);
    setServerErrors([]);
    if (found.name || found.list || Object.keys(found.tasks).length) return;

    setSaving(true);
    const result = await dispatch(
      saveTemplate({
        id: template?.id ?? null,
        payload: {
          name: name.trim(),
          ...(template ? {} : { kind }),
          tasks: tasks.map(({ uid: _uid, assignee, ...t }) => ({
            ...t,
            title: t.title.trim(),
            instructions: t.instructions.trim(),
            assignee: { kind: assignee.kind, userId: assignee.kind === 'person' ? assignee.userId : null },
            questions: t.type === 'form' ? t.questions.map((q) => q.trim()).filter(Boolean) : [],
            link: t.link?.trim() ? t.link.trim() : null,
          })),
        },
      })
    );
    setSaving(false);
    if (saveTemplate.rejected.match(result)) {
      const fieldErrors = (result.payload?.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors;
      if (fieldErrors?.name) setProblems({ tasks: {}, name: fieldErrors.name[0] });
      setServerErrors(fieldErrors?.tasks ?? (fieldErrors?.name ? [] : [result.payload?.message ?? 'Could not save the template']));
      return;
    }
    void message.success(`Saved ${name.trim()}`);
    onClose();
  };

  const personOptions = people.map((p) => ({ value: p.id, label: p.jobTitle ? `${p.name} · ${p.jobTitle}` : p.name }));

  return (
    <Drawer
      open={open}
      width={760}
      onClose={onClose}
      destroyOnHidden
      title={template ? `Edit ${template.name}` : `New ${kind} template`}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={saving} onClick={onSave}>
            Save template
          </Button>
        </div>
      }
    >
      <Form layout="vertical">
        <Form.Item label="Name" htmlFor="te-name" validateStatus={problems.name ? 'error' : ''} help={problems.name}>
          <Input id="te-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'onboarding' ? 'e.g. Engineering onboarding' : 'e.g. Standard offboarding'} />
        </Form.Item>
      </Form>
      {serverErrors.length ? <Alert className="mb-3" type="error" showIcon message="Please fix these" description={<ul className="m-0 pl-4">{serverErrors.map((e) => <li key={e}>{e}</li>)}</ul>} /> : null}
      {problems.list ? <Alert className="mb-3" type="error" showIcon message={problems.list} /> : null}

      <div className="flex flex-col gap-3">
        {tasks.map((t, i) => (
          <Card
            key={t.uid}
            size="small"
            data-testid="template-task"
            style={problems.tasks[i] ? { borderColor: token.colorError } : undefined}
            title={`Task ${i + 1}`}
            extra={
              <Space size={0}>
                <Tooltip title="Move up">
                  <Button type="text" size="small" icon={<ArrowUpOutlined />} aria-label={`Move task ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)} />
                </Tooltip>
                <Tooltip title="Move down">
                  <Button type="text" size="small" icon={<ArrowDownOutlined />} aria-label={`Move task ${i + 1} down`} disabled={i === tasks.length - 1} onClick={() => move(i, 1)} />
                </Tooltip>
                <Tooltip title="Remove">
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={`Remove task ${i + 1}`}
                    disabled={tasks.length === 1}
                    onClick={() => setTasks((all) => all.filter((_, j) => j !== i))}
                  />
                </Tooltip>
              </Space>
            }
          >
            {problems.tasks[i] ? (
              <div className="mb-2 text-sm" style={{ color: token.colorError }}>
                {problems.tasks[i]}
              </div>
            ) : null}
            <Form layout="vertical">
              <Form.Item label="Title" htmlFor={`te-title-${i}`} className="!mb-3">
                <Input id={`te-title-${i}`} maxLength={120} value={t.title} onChange={(e) => change(i, { title: e.target.value })} />
              </Form.Item>
              <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-3">
                <Form.Item label="Who" htmlFor={`te-who-${i}`} className="!mb-3">
                  <Select
                    id={`te-who-${i}`}
                    value={t.assignee.kind}
                    options={assigneeOptions(kind)}
                    onChange={(v) => change(i, { assignee: { kind: v, userId: v === 'person' ? t.assignee.userId : null } })}
                  />
                </Form.Item>
                <Form.Item label="Due (days)" htmlFor={`te-due-${i}`} className="!mb-3" extra={offsetText(t.dueOffsetDays, kind)}>
                  <InputNumber
                    id={`te-due-${i}`}
                    className="w-full"
                    min={MIN_OFFSET}
                    max={MAX_OFFSET}
                    precision={0}
                    value={t.dueOffsetDays}
                    onChange={(v) => change(i, { dueOffsetDays: v ?? 0 })}
                  />
                </Form.Item>
                <Form.Item label="Type" htmlFor={`te-type-${i}`} className="!mb-3">
                  <Select id={`te-type-${i}`} value={t.type} options={TYPE_OPTIONS} onChange={(v) => change(i, { type: v, questions: v === 'form' && !t.questions.length ? [''] : t.questions })} />
                </Form.Item>
              </div>
              {t.assignee.kind === 'person' ? (
                <Form.Item label="Person" htmlFor={`te-person-${i}`} className="!mb-3">
                  <Select
                    id={`te-person-${i}`}
                    showSearch
                    optionFilterProp="label"
                    placeholder="Choose a person"
                    value={t.assignee.userId ?? undefined}
                    options={
                      t.assignee.userId && !people.some((p) => p.id === t.assignee.userId)
                        ? [...personOptions, { value: t.assignee.userId, label: `${t.assignee.name ?? 'Former member'} (inactive)` }]
                        : personOptions
                    }
                    onChange={(v) => change(i, { assignee: { kind: 'person', userId: v } })}
                  />
                </Form.Item>
              ) : null}
              {t.type === 'form' ? (
                <Form.Item label="Questions" className="!mb-3">
                  <div className="flex flex-col gap-2">
                    {t.questions.map((q, qi) => (
                      <div key={qi} className="flex gap-2">
                        <Input
                          aria-label={`Task ${i + 1} question ${qi + 1}`}
                          maxLength={200}
                          value={q}
                          onChange={(e) => change(i, { questions: t.questions.map((x, k) => (k === qi ? e.target.value : x)) })}
                        />
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          aria-label={`Remove task ${i + 1} question ${qi + 1}`}
                          onClick={() => change(i, { questions: t.questions.filter((_, k) => k !== qi) })}
                        />
                      </div>
                    ))}
                    {t.questions.length < MAX_QUESTIONS ? (
                      <Button size="small" icon={<PlusOutlined />} className="self-start" onClick={() => change(i, { questions: [...t.questions, ''] })}>
                        Add question
                      </Button>
                    ) : null}
                  </div>
                </Form.Item>
              ) : null}
              <Form.Item label="Instructions (optional)" htmlFor={`te-instructions-${i}`} className="!mb-3">
                <Input.TextArea id={`te-instructions-${i}`} rows={2} maxLength={1000} value={t.instructions} onChange={(e) => change(i, { instructions: e.target.value })} />
              </Form.Item>
              <Form.Item label="Link (optional)" htmlFor={`te-link-${i}`} className="!mb-0">
                <Input id={`te-link-${i}`} maxLength={500} placeholder="/home?tab=welcome or https://…" value={t.link ?? ''} onChange={(e) => change(i, { link: e.target.value })} />
              </Form.Item>
            </Form>
          </Card>
        ))}
      </div>
      {tasks.length < MAX_TASKS ? (
        <Button className="mt-3" icon={<PlusOutlined />} onClick={() => setTasks((all) => [...all, blankTask()])}>
          Add task
        </Button>
      ) : (
        <div className="mt-3 text-sm" style={{ color: token.colorTextSecondary }}>
          A template can have at most {MAX_TASKS} tasks.
        </div>
      )}
    </Drawer>
  );
}
