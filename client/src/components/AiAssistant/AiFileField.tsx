import { UploadOutlined } from '@ant-design/icons';
import { Button, Space, Typography } from 'antd';
import { useEffect, useRef } from 'react';

// What the APIs take (server/src/middlewares/upload.ts): checked here to fail early, on the card.
const KINDS = {
  document: {
    types: ['application/pdf', 'image/jpeg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    extensions: /\.(?:pdf|jpe?g|png|docx?)$/i,
    accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx',
    words: 'a PDF, Word, JPEG or PNG file',
  },
  // As the claim drawer's Add receipt button takes them.
  receipt: { types: ['application/pdf', 'image/jpeg', 'image/png'], extensions: /\.(?:pdf|jpe?g|png)$/i, accept: '.pdf,.jpg,.jpeg,.png', words: 'a PDF, JPEG or PNG file' },
} as const;
export type AiFileKind = keyof typeof KINDS;
const MAX_BYTES = 10 * 1024 * 1024;

/** Why this file can't be uploaded, or null when it can. */
export function fileProblem(file: File, kind: AiFileKind = 'document'): string | null {
  const rules = KINDS[kind];
  // Some systems give Word files no type: the extension decides then.
  const typeOk = file.type ? (rules.types as readonly string[]).includes(file.type) : rules.extensions.test(file.name);
  if (!typeOk) return `Choose ${rules.words}.`;
  if (file.size > MAX_BYTES) return 'The file is larger than 10 MB.';
  return null;
}

/** 1 258 291 bytes → "1.2 MB", as the assistant's answers show sizes. */
export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

interface AiFileFieldProps {
  file: File | null;
  error: string | null;
  /** The file there now (a new version replaces it). */
  current?: string;
  disabled: boolean;
  /** Open the picker as soon as the card appears. */
  autoOpen: boolean;
  /** What the endpoint takes; documents by default. */
  kind?: AiFileKind;
  /** The file isn't required: say so on the field. */
  optional?: boolean;
  onPick: (file: File) => void;
}

/** A confirm card's file: chosen here and sent with the Confirm click. */
export function AiFileField({ file, error, current, disabled, autoOpen, kind = 'document', optional, onPick }: AiFileFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const opened = useRef(false);

  // Browsers open a file picker only just after a click or a key press: a quick answer gets it
  // at once, otherwise it does nothing and Choose file is there. Once only, also under StrictMode.
  useEffect(() => {
    if (autoOpen && !opened.current) {
      opened.current = true;
      input.current?.click();
    }
  }, [autoOpen]);

  return (
    <div className="mt-3" data-testid="ai-file-field">
      <input
        ref={input}
        type="file"
        accept={KINDS[kind].accept}
        hidden
        aria-label={kind === 'receipt' ? 'Receipt to upload' : 'File to upload'}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) onPick(picked);
          // So the same file can be chosen again after an error.
          e.target.value = '';
        }}
      />
      <Space wrap size="small" align="center">
        <Button size="small" icon={<UploadOutlined />} disabled={disabled} onClick={() => input.current?.click()}>
          {file ? 'Choose another file' : kind === 'receipt' ? `Choose receipt${optional ? ' (optional)' : ''}` : 'Choose file'}
        </Button>
        <Typography.Text type={file ? undefined : 'secondary'} className="text-xs">
          {file ? `${file.name} (${fileSize(file.size)})` : kind === 'receipt' ? 'PDF, JPEG or PNG, up to 10 MB' : 'PDF, Word, JPEG or PNG, up to 10 MB'}
        </Typography.Text>
      </Space>
      {current && !file ? (
        <Typography.Text type="secondary" className="mt-1 block text-xs">
          Now: {current}
        </Typography.Text>
      ) : null}
      {error ? (
        <Typography.Text type="danger" className="mt-1 block text-xs">
          {error}
        </Typography.Text>
      ) : null}
    </div>
  );
}
