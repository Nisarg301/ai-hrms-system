import { CheckCircleOutlined, DownloadOutlined } from '@ant-design/icons';
import { Alert, Button, Space, Table, Tooltip, Typography, theme } from 'antd';
import { Fragment } from 'react';
import type { AiChatMessage, AiDownload, AiFormValues, AiToolCallRef } from '../../types/ai';
import { AiConfirmCard } from './AiConfirmCard';
import type { ConfirmOutcome } from './useAiChat';
import type { AiDownloadState } from './useAiDownloads';

/** Answers may mark words as **bold**; everything else is plain text (never HTML). */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>
      )}
    </span>
  );
}

interface AiMessageProps {
  message: AiChatMessage;
  /** Buttons are only live on the newest answer. */
  interactive: boolean;
  onButton: (toolCall: AiToolCallRef, label: string) => void;
  onConfirm: (actionId: string, values?: AiFormValues, file?: File) => Promise<ConfirmOutcome>;
  onCancel: (actionId: string) => void;
  /** Each offered file's download state, by path. */
  downloadStates?: Record<string, AiDownloadState>;
  onDownload?: (file: AiDownload) => void;
}

/**
 * The files an answer offers. A download changes nothing, so the buttons stay live on older
 * answers too: each one downloads its file (again).
 */
function DownloadList({ files, states, several, onDownload }: { files: AiDownload[]; states: Record<string, AiDownloadState>; several: boolean; onDownload?: (file: AiDownload) => void }) {
  const { token } = theme.useToken();
  const errors = files.flatMap((f) => {
    const state = states[f.path];
    return state?.status === 'error' ? [state.error] : [];
  });
  return (
    <div className="mt-2">
      <Space wrap>
        {files.map((f) => {
          const done = states[f.path]?.status === 'done';
          return (
            <Tooltip key={f.path} title={done ? 'Downloaded. Click to download it again.' : undefined}>
              <Button
                size="small"
                icon={done ? <CheckCircleOutlined style={{ color: token.colorSuccess }} /> : <DownloadOutlined />}
                loading={states[f.path]?.status === 'busy'}
                onClick={() => onDownload?.(f)}
                aria-label={`Download ${f.label}`}
              >
                {f.label}
              </Button>
            </Tooltip>
          );
        })}
      </Space>
      {errors.map((error) => (
        <Typography.Text key={error} type="danger" className="mt-1 block text-xs">
          {error}
        </Typography.Text>
      ))}
      {several ? (
        <Typography.Text type="secondary" className="mt-1 block text-xs">
          If your browser asks whether this site may download multiple files, choose Allow.
        </Typography.Text>
      ) : null}
    </div>
  );
}

export function AiMessage({ message, interactive, onButton, onConfirm, onCancel, downloadStates, onDownload }: AiMessageProps) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--ai-user-bg)] px-3 py-2 text-[var(--ai-user-fg)]">{message.text}</div>
      </div>
    );
  }
  if (message.action) {
    const { action } = message;
    return <AiConfirmCard action={action} live={message.live} onConfirm={(values, file) => onConfirm(action.id, values, file)} onCancel={() => onCancel(action.id)} />;
  }
  const result = message.result;
  if (!result) return null;
  return (
    <div className="max-w-full rounded-2xl rounded-bl-sm bg-[var(--ai-bot-bg)] px-3 py-2">
      <RichText text={result.text} />
      {result.warnings?.length ? (
        <Alert className="!mt-2" type="warning" showIcon message={result.warnings.map((w) => <div key={w}>{w}</div>)} />
      ) : null}
      {result.table ? (
        <Table
          className="mt-2"
          size="small"
          pagination={false}
          scroll={{ x: true }}
          rowKey="__row"
          columns={result.table.columns.map((c) => ({ key: c.key, dataIndex: c.key, title: c.title }))}
          dataSource={result.table.rows.map((r, i) => ({ ...r, __row: String(i) }))}
        />
      ) : null}
      {result.downloads?.length ? (
        <DownloadList files={result.downloads} states={downloadStates ?? {}} several={result.downloads.length > 1 && Boolean(result.autoDownload)} onDownload={onDownload} />
      ) : null}
      {result.buttons?.length ? (
        <Space className="mt-2" wrap>
          {result.buttons.map((b) => (
            <Button key={b.label} size="small" disabled={!interactive} onClick={() => onButton(b.toolCall, b.label)}>
              {b.label}
            </Button>
          ))}
        </Space>
      ) : null}
    </div>
  );
}
