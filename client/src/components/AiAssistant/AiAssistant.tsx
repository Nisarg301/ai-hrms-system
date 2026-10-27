import { AudioOutlined, LoadingOutlined, PlusOutlined, RobotOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import { Alert, Button, Drawer, FloatButton, Input, Space, Tooltip, Typography, theme } from 'antd';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ROUTES } from '../../constants/routes';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { useHasFeature } from '../../hooks/useHasFeature';
import { listAiModulesRequest } from '../../services/endpoints/ai.endpoints';
import { selectAuthUser } from '../../store/auth/authSelectors';
import { refreshMyAttendance } from '../../store/attendance/attendanceThunks';
import { fetchDepartments } from '../../store/departments/departmentsThunks';
import { fetchDocuments } from '../../store/documents/documentsThunks';
import { fetchEmployees } from '../../store/employees/employeesThunks';
import { fetchMyClaims } from '../../store/expenses/expensesThunks';
import { fetchAllCategories } from '../../store/expensesAdmin/expensesAdminThunks';
import { refreshAfterLeaveChange } from '../../store/leave/leaveThunks';
import { fetchProjects } from '../../store/projects/projectsThunks';
import { fetchRoles } from '../../store/roles/rolesThunks';
import { fetchTasks } from '../../store/tasks/tasksThunks';
import type { AiModuleInfo } from '../../types/ai';
import { TempPasswordModal } from '../TempPasswordModal/TempPasswordModal';
import { AiMessage } from './AiMessage';
import { useAiChat, type PendingReply } from './useAiChat';
import { useAiDownloads } from './useAiDownloads';
import { useSpeechInput } from './useSpeechInput';

// The chat assistant (docs/AI_ASSISTANT_PLAN.md): one per module page, on a local Ollama model.
// The server decides who may use which assistant; this only maps pages to modules, with an
// example request for the input box.
const MODULE_ROUTES: { prefix: string; module: string; example: string }[] = [
  { prefix: ROUTES.employees, module: 'employees', example: 'Add Mike Johnson to Engineering' },
  { prefix: ROUTES.projects, module: 'projects', example: 'Create a project called Apollo due 31 December' },
  { prefix: ROUTES.departments, module: 'departments', example: 'Create a department called Design' },
  { prefix: ROUTES.exports, module: 'exports', example: 'Download employees and projects' },
  { prefix: ROUTES.tasks, module: 'tasks', example: 'Mark the login bug as done' },
  { prefix: ROUTES.documents, module: 'documents', example: 'Upload the employee handbook' },
  { prefix: ROUTES.roles, module: 'roles', example: 'Create a role Auditor with all permissions' },
  { prefix: ROUTES.expenses, module: 'expenses', example: 'Show submitted claims for this month' },
  { prefix: ROUTES.auditLogs, module: 'auditLogs', example: 'Show deleted records in Projects last week' },
  // The Me page: three of its seven tabs (docs/AI_ME_ASSISTANTS.md); the other four have none.
  { prefix: ROUTES.meLeave, module: 'leave', example: 'Apply for leave from 3 Nov to 5 Nov' },
  { prefix: `${ROUTES.me}/attendance`, module: 'attendance', example: 'Work from home tomorrow' },
  { prefix: `${ROUTES.me}/expenses`, module: 'my-expenses', example: 'New claim for client visit to Pune' },
];

/** Mounted once in AppLayout. Shows a button on pages that have an assistant this user may open. */
export function AiAssistant() {
  const location = useLocation();
  const user = useAppSelector(selectAuthUser);
  const hasFeature = useHasFeature();
  const route = MODULE_ROUTES.find((r) => location.pathname.startsWith(r.prefix));
  const moduleKey = route?.module;
  const isMember = user?.role === 'ORG_ADMIN' || user?.role === 'ORG_USER';
  const wanted = Boolean(moduleKey) && isMember && hasFeature('ai');
  const [modules, setModules] = useState<AiModuleInfo[] | null>(null);

  useEffect(() => {
    if (!wanted || modules) return;
    // 503 (assistant turned off on the server) or 403 simply means no button.
    listAiModulesRequest()
      .then(({ data }) => setModules(data))
      .catch(() => setModules([]));
  }, [wanted, modules]);

  const info = wanted ? modules?.find((m) => m.key === moduleKey) : undefined;
  return info && route ? <AssistantDrawer key={info.key} info={info} example={route.example} prefix={route.prefix} /> : null;
}

function AssistantDrawer({ info, example, prefix }: { info: AiModuleInfo; example: string; prefix: string }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const downloads = useAiDownloads();
  const chat = useAiChat(info.key, {
    // Reload the page's table behind the drawer after a confirmed change.
    onChanged: () => {
      if (info.key === 'employees') void dispatch(fetchEmployees());
      if (info.key === 'projects') void dispatch(fetchProjects());
      if (info.key === 'departments') void dispatch(fetchDepartments());
      if (info.key === 'tasks') void dispatch(fetchTasks());
      if (info.key === 'documents') void dispatch(fetchDocuments());
      if (info.key === 'roles') void dispatch(fetchRoles());
      if (info.key === 'expenses') void dispatch(fetchAllCategories());
      if (info.key === 'leave') void dispatch(refreshAfterLeaveChange());
      if (info.key === 'attendance') void dispatch(refreshMyAttendance());
      if (info.key === 'my-expenses') void dispatch(fetchMyClaims());
    },
    // The page behind the drawer follows a live answer (the Expenses tab and its filters), on its own page only.
    onView: (path) => {
      if (path === prefix || path.startsWith(`${prefix}?`)) navigate(path, { replace: true });
    },
    onSecret: (s) => setSecret(s.value),
    onDownloads: (files) => void downloads.downloadAll(files),
  });
  const speech = useSpeechInput();
  const { loadHistory } = chat;

  useEffect(() => {
    if (open) void loadHistory();
  }, [open, loadHistory]);

  // Keep the newest answer in view.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [chat.messages, chat.pending]);

  const busy = Boolean(chat.pending);
  const send = (text: string) => {
    if (busy || !text.trim()) return;
    chat.send(text);
    setDraft('');
  };
  const toggleMic = () => {
    if (speech.listening) speech.stop();
    else speech.start((text) => send(text));
  };

  const colors = {
    '--ai-user-bg': token.colorPrimary,
    '--ai-user-fg': token.colorTextLightSolid,
    '--ai-bot-bg': token.colorFillQuaternary,
  } as CSSProperties;
  const lastIndex = chat.messages.length - 1;

  return (
    <>
      <FloatButton type="primary" icon={<RobotOutlined />} tooltip={info.title} aria-label={`Open the ${info.title}`} onClick={() => setOpen(true)} style={{ insetInlineEnd: 24, insetBlockEnd: 24 }} />
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        width={typeof window !== 'undefined' && window.innerWidth < 520 ? '100%' : 460}
        title={
          <div>
            <div>{info.title}</div>
            <Typography.Text type="secondary" className="text-xs font-normal">
              {info.intro}
            </Typography.Text>
          </div>
        }
        extra={
          <Tooltip title="Start a new conversation">
            <Button size="small" icon={<PlusOutlined />} onClick={chat.newChat} disabled={busy}>
              New chat
            </Button>
          </Tooltip>
        }
        styles={{ body: { display: 'flex', flexDirection: 'column', padding: 0 } }}
      >
        <div ref={listRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-3" style={colors} aria-live="polite">
          {chat.messages.length === 0 && !busy ? (
            <div className="flex flex-col gap-2">
              <Typography.Text type="secondary">Try one of these, or type or speak your own request.</Typography.Text>
              <Space wrap>
                {info.starters.map((s) => (
                  <Button key={s.label} size="small" onClick={() => chat.runToolCall(s.toolCall, s.label)}>
                    {s.label}
                  </Button>
                ))}
              </Space>
            </div>
          ) : null}
          {chat.messages.map((message, i) => (
            <AiMessage
              key={`${i}-${message.createdAt}`}
              message={message}
              interactive={i === lastIndex && !busy}
              onButton={(toolCall, label) => !busy && chat.runToolCall(toolCall, label)}
              onConfirm={chat.confirm}
              onCancel={(id) => void chat.cancel(id)}
              downloadStates={downloads.states}
              onDownload={(file) => void downloads.download(file)}
            />
          ))}
          {chat.pending ? <PendingBubble pending={chat.pending} onStop={chat.stop} /> : null}
          {chat.error ? <Alert type="error" showIcon message={chat.error} /> : null}
        </div>

        <div className="border-t p-3" style={{ borderColor: token.colorBorderSecondary }}>
          {speech.listening ? (
            <Typography.Text type="secondary" className="mb-1 block text-xs">
              Listening… pause to send, Esc to cancel. Voice is turned into text by your browser's speech service.
            </Typography.Text>
          ) : null}
          {speech.error ? <Typography.Text type="danger" className="mb-1 block text-xs">{speech.error}</Typography.Text> : null}
          <div className="flex items-end gap-2">
            <Input.TextArea
              aria-label="Message the assistant"
              autoSize={{ minRows: 1, maxRows: 4 }}
              maxLength={2000}
              placeholder={`Type or speak, e.g. ${example}`}
              value={speech.listening ? speech.interim : draft}
              readOnly={speech.listening}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && speech.listening) speech.cancel();
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
            />
            {speech.supported ? (
              <Tooltip title={speech.listening ? 'Stop and send' : 'Speak'}>
                <Button
                  aria-label={speech.listening ? 'Stop listening' : 'Speak a request'}
                  type={speech.listening ? 'primary' : 'default'}
                  danger={speech.listening}
                  icon={<AudioOutlined />}
                  onClick={toggleMic}
                  disabled={busy && !speech.listening}
                />
              </Tooltip>
            ) : null}
            {busy ? (
              <Button aria-label="Stop" icon={<StopOutlined />} onClick={chat.stop} />
            ) : (
              <Button aria-label="Send" type="primary" icon={<SendOutlined />} onClick={() => send(draft)} disabled={!draft.trim()} />
            )}
          </div>
        </div>
      </Drawer>
      <TempPasswordModal open={secret !== null} password={secret} onClose={() => setSecret(null)} />
    </>
  );
}

/** Progress while the model works: CPU-only machines take several seconds per step. */
function PendingBubble({ pending, onStop }: { pending: PendingReply; onStop: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - pending.startedAt) / 1000));
  const label =
    pending.state === 'queued'
      ? `Waiting for the assistant (${pending.ahead ?? 1} ahead)…`
      : pending.tool
        ? `${pending.tool}…`
        : 'Thinking…';
  return (
    <div className="rounded-2xl rounded-bl-sm bg-[var(--ai-bot-bg)] px-3 py-2" data-testid="ai-pending">
      {pending.text ? <div className="mb-1 whitespace-pre-wrap">{pending.text}</div> : null}
      <Space size="small">
        <LoadingOutlined />
        <Typography.Text type="secondary">
          {label} {seconds >= 2 ? `${seconds}s` : ''}
        </Typography.Text>
        <Button size="small" type="link" onClick={onStop}>
          Stop
        </Button>
      </Space>
    </div>
  );
}
