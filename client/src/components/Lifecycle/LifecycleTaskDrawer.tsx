import { CheckOutlined, DeleteOutlined, ExportOutlined, FileOutlined, PaperClipOutlined } from '@ant-design/icons';
import { Alert, Button, Checkbox, Drawer, Input, message, Space, Tag, theme, Typography, Upload } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppDispatch } from '../../hooks/store';
import { getTaskFileRequest } from '../../services/endpoints/lifecycle.endpoints';
import { completeLifecycleTask, deleteLifecycleFile, uploadLifecycleFile } from '../../store/lifecycle/lifecycleThunks';
import type { LifecycleTask, TaskFile } from '../../types/lifecycle';
import { dueText, TASK_TYPE_LABEL } from '../../utils/lifecycleFormat';
import { openBlobInNewTab } from '../../utils/openBlob';

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

interface LifecycleTaskDrawerProps {
  /** The task to show; null = closed. */
  task: LifecycleTask | null;
  /** Whose process: "Your onboarding", "Ivy Mehta's onboarding". */
  whose: string;
  today: string;
  onClose: () => void;
  /** After it's marked done. */
  onDone?: (task: LifecycleTask) => void;
}

const openFile = (task: LifecycleTask, file: TaskFile) =>
  openBlobInNewTab(async () => (await getTaskFileRequest(task.id, file.id)).data, 'Could not open the file');

function TaskLink({ link }: { link: string }) {
  return link.startsWith('/') ? (
    <Link to={link}>
      Open <ExportOutlined />
    </Link>
  ) : (
    <a href={link} target="_blank" rel="noopener noreferrer">
      Open link <ExportOutlined />
    </a>
  );
}

function FileList({ task, removable }: { task: LifecycleTask; removable: boolean }) {
  const dispatch = useAppDispatch();
  return (
    <div className="flex flex-wrap gap-2">
      {task.files.map((f) => (
        <Tag
          key={f.id}
          icon={<FileOutlined />}
          className="!mr-0"
          closable={removable}
          closeIcon={removable ? <DeleteOutlined aria-label={`Remove ${f.originalName}`} /> : undefined}
          onClose={async (e) => {
            e.preventDefault();
            const result = await dispatch(deleteLifecycleFile({ taskId: task.id, fileId: f.id }));
            if (deleteLifecycleFile.rejected.match(result)) void message.error(result.payload?.message ?? 'Could not remove the file');
          }}
        >
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 underline" onClick={() => void openFile(task, f)}>
            {f.originalName}
          </button>
        </Tag>
      ))}
    </div>
  );
}

/** How a finished task ended: who did it, the note, the files, the answers (admins only). */
function Outcome({ task }: { task: LifecycleTask }) {
  const { token } = theme.useToken();
  if (task.status === 'skipped') {
    return <Alert type="info" showIcon message="Skipped" description={task.skipReason || undefined} />;
  }
  return (
    <div className="flex flex-col gap-3">
      <Alert
        type="success"
        showIcon
        message={`Done${task.completedByName ? ` by ${task.completedByName}` : ''}${task.completedAt ? ` on ${dayjs(task.completedAt).format('D MMM YYYY')}` : ''}`}
      />
      {task.acknowledged ? <div>✓ Read and confirmed</div> : null}
      {task.note ? <div style={{ whiteSpace: 'pre-wrap' }}>“{task.note}”</div> : null}
      {task.files.length ? <FileList task={task} removable={false} /> : null}
      {task.answers?.length ? (
        <dl className="m-0">
          {task.answers.map((a) => (
            <div key={a.question} className="mb-2">
              <dt className="font-medium">{a.question}</dt>
              <dd className="m-0" style={{ color: token.colorTextSecondary, whiteSpace: 'pre-wrap' }}>
                {a.text}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** One onboarding/offboarding task: read the instructions, then complete it the way its type needs. */
export function LifecycleTaskDrawer({ task, whose, today, onClose, onDone }: LifecycleTaskDrawerProps) {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const [note, setNote] = useState('');
  const [answers, setAnswers] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taskId = task?.id;
  useEffect(() => {
    setNote('');
    setAnswers(task ? task.questions.map(() => '') : []);
    setAcknowledged(false);
    setError(null);
    // Reset only when a different task opens, not when this one's files change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  if (!task) return <Drawer open={false} />;
  const pending = task.status === 'pending';
  const typeLabel = TASK_TYPE_LABEL[task.type];

  const ready =
    task.type === 'upload' ? task.files.length > 0 : task.type === 'acknowledge' ? acknowledged : task.type === 'form' ? answers.every((a) => a.trim()) : true;

  const onUpload = async (file: File) => {
    if (!FILE_TYPES.includes(file.type)) {
      void message.error('Files can be PDF, JPG or PNG');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      void message.error('A file can be at most 10 MB');
      return;
    }
    setUploading(true);
    const result = await dispatch(uploadLifecycleFile({ taskId: task.id, file }));
    setUploading(false);
    if (uploadLifecycleFile.rejected.match(result)) void message.error(result.payload?.message ?? 'Could not upload the file');
  };

  const onComplete = async () => {
    setSaving(true);
    setError(null);
    const result = await dispatch(
      completeLifecycleTask({
        taskId: task.id,
        payload: {
          note: note.trim(),
          ...(task.type === 'form' ? { answers: answers.map((a) => a.trim()) } : {}),
          ...(task.type === 'acknowledge' ? { acknowledged } : {}),
        },
      })
    );
    setSaving(false);
    if (completeLifecycleTask.rejected.match(result)) {
      const fieldErrors = (result.payload?.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors;
      setError(fieldErrors ? Object.values(fieldErrors)[0][0] : (result.payload?.message ?? 'Could not complete the task'));
      return;
    }
    void message.success(`Done: ${task.title}`);
    onDone?.(result.payload);
    onClose();
  };

  return (
    <Drawer
      open
      width={520}
      onClose={onClose}
      destroyOnHidden
      title={
        <div>
          <div>{task.title}</div>
          <div className="text-xs font-normal" style={{ color: token.colorTextSecondary }}>
            {whose}
          </div>
        </div>
      }
      footer={
        pending ? (
          <div className="flex justify-end">
            <Button type="primary" icon={<CheckOutlined />} loading={saving} disabled={!ready} onClick={onComplete}>
              {task.type === 'form' ? 'Submit answers' : 'Mark as done'}
            </Button>
          </div>
        ) : null
      }
    >
      <Space wrap className="mb-3">
        <Tag color={task.overdue ? 'red' : task.status === 'done' ? 'green' : 'default'} className="!mr-0">
          {dueText(task, today)}
        </Tag>
        {pending ? <Tag className="!mr-0">Due {dayjs(task.dueDate).format('D MMM YYYY')}</Tag> : null}
        {typeLabel ? <Tag className="!mr-0">{typeLabel}</Tag> : null}
      </Space>
      {task.instructions ? (
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{task.instructions}</Typography.Paragraph>
      ) : null}
      {task.link ? (
        <div className="mb-4">
          <TaskLink link={task.link} />
        </div>
      ) : null}

      {!pending ? (
        <Outcome task={task} />
      ) : (
        <div className="flex flex-col gap-4">
          {error ? <Alert type="error" showIcon message={error} /> : null}

          {task.type === 'upload' ? (
            <div>
              <div className="mb-2 font-medium">Files</div>
              {task.files.length ? <FileList task={task} removable /> : <div style={{ color: token.colorTextSecondary }}>No file yet.</div>}
              {task.files.length < MAX_FILES ? (
                <Upload
                  accept=".pdf,.jpg,.jpeg,.png"
                  showUploadList={false}
                  beforeUpload={(file) => {
                    void onUpload(file);
                    return false;
                  }}
                >
                  <Button className="mt-2" icon={<PaperClipOutlined />} loading={uploading}>
                    Add a file
                  </Button>
                </Upload>
              ) : null}
              <div className="mt-1 text-xs" style={{ color: token.colorTextSecondary }}>
                PDF, JPG or PNG, up to 10 MB each, at most {MAX_FILES}.
              </div>
            </div>
          ) : null}

          {task.type === 'acknowledge' ? (
            <Checkbox checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)}>
              I’ve read this
            </Checkbox>
          ) : null}

          {task.type === 'form'
            ? task.questions.map((q, i) => (
                <div key={q}>
                  <label htmlFor={`lc-answer-${i}`} className="mb-1 block font-medium">
                    {q}
                  </label>
                  <Input.TextArea
                    id={`lc-answer-${i}`}
                    rows={3}
                    maxLength={2000}
                    value={answers[i] ?? ''}
                    onChange={(e) => setAnswers((prev) => prev.map((a, j) => (j === i ? e.target.value : a)))}
                  />
                </div>
              ))
            : null}
          {task.type === 'form' ? (
            <div className="text-xs" style={{ color: token.colorTextSecondary }}>
              Only your admins will see your answers.
            </div>
          ) : null}

          <div>
            <label htmlFor="lc-note" className="mb-1 block">
              Note (optional)
            </label>
            <Input.TextArea id="lc-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {!ready && task.type === 'upload' ? (
            <div className="text-xs" style={{ color: token.colorTextSecondary }}>
              Add at least one file to mark it done.
            </div>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
