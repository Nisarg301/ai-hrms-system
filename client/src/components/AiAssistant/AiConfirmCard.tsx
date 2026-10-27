import { CheckCircleOutlined, CloseCircleOutlined, EditOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Space, Tag, Typography, theme } from 'antd';
import { useState } from 'react';
import type { AiAction, AiCardForm, AiFormValues } from '../../types/ai';
import { AiFixForm, AiWfhForm, validateFixValues, validateWfhValues } from './AiAttendanceForms';
import { AiCategoryForm, validateCategoryValues } from './AiCategoryForm';
import { AiClaimForm, claimNeedsReceipt, validateClaimValues } from './AiClaimForm';
import { AiDepartmentForm, validateDepartmentValues } from './AiDepartmentForm';
import { AiDocumentForm, validateDocumentValues } from './AiDocumentForm';
import { AiEmployeeForm, validateEmployeeValues } from './AiEmployeeForm';
import { AiLeaveForm, validateLeaveValues } from './AiLeaveForm';
import { AiFileField, fileProblem } from './AiFileField';
import { AiProjectForm, validateProjectValues } from './AiProjectForm';
import { AiRoleForm, validateRoleValues } from './AiRoleForm';
import { AiTaskForm, validateTaskValues } from './AiTaskForm';
import type { ConfirmOutcome } from './useAiChat';

interface AiConfirmCardProps {
  action: AiAction;
  /** The card arrived live (not from history): it may open the file picker by itself. */
  live?: boolean;
  onConfirm: (values?: AiFormValues, file?: File) => Promise<ConfirmOutcome>;
  onCancel: () => void;
}

const STATUS_TAGS = {
  confirmed: <Tag icon={<CheckCircleOutlined />} color="success">Done</Tag>,
  cancelled: <Tag icon={<CloseCircleOutlined />}>Cancelled</Tag>,
  expired: <Tag icon={<ExclamationCircleOutlined />}>Expired: ask again</Tag>,
} as const;

/** Checks a card's form with the same rules as the page's own form. */
function validate(form: AiCardForm): Record<string, string> {
  if (form.kind === 'employee') return validateEmployeeValues(form.values);
  if (form.kind === 'project') return validateProjectValues(form.values);
  if (form.kind === 'task') return validateTaskValues(form.values);
  if (form.kind === 'document') return validateDocumentValues(form.values);
  if (form.kind === 'role') return validateRoleValues(form.values);
  if (form.kind === 'category') return validateCategoryValues(form.values);
  if (form.kind === 'leave') return validateLeaveValues(form.values);
  if (form.kind === 'wfh') return validateWfhValues(form.values);
  if (form.kind === 'fix') return validateFixValues(form.values);
  if (form.kind === 'claim') return validateClaimValues(form.values, form.mode);
  return validateDepartmentValues(form.values);
}

/** The form fields for the card's kind of record. */
function CardForm({ form, errors, onChange }: { form: AiCardForm; errors: Record<string, string>; onChange: (form: AiCardForm) => void }) {
  if (form.kind === 'employee') {
    return <AiEmployeeForm mode={form.mode} values={form.values} errors={errors} onChange={(values) => onChange({ ...form, values })} />;
  }
  if (form.kind === 'project') {
    return <AiProjectForm values={form.values} errors={errors} onChange={(values) => onChange({ ...form, values })} />;
  }
  if (form.kind === 'task') {
    return <AiTaskForm values={form.values} labels={form.labels} errors={errors} onChange={(values) => onChange({ ...form, values })} />;
  }
  if (form.kind === 'document') {
    return <AiDocumentForm values={form.values} categories={form.categories} errors={errors} onChange={(values) => onChange({ ...form, values })} />;
  }
  if (form.kind === 'role') {
    return <AiRoleForm values={form.values} errors={errors} onChange={(values) => onChange({ ...form, values })} />;
  }
  if (form.kind === 'category') {
    return <AiCategoryForm values={form.values} errors={errors} onChange={(values) => onChange({ ...form, values })} />;
  }
  if (form.kind === 'leave') {
    return <AiLeaveForm values={form.values} types={form.types} errors={errors} onChange={(values) => onChange({ ...form, values })} />;
  }
  if (form.kind === 'wfh') {
    return <AiWfhForm values={form.values} errors={errors} onChange={(values) => onChange({ ...form, values })} />;
  }
  if (form.kind === 'fix') {
    return <AiFixForm values={form.values} errors={errors} onChange={(values) => onChange({ ...form, values })} />;
  }
  if (form.kind === 'claim') {
    return <AiClaimForm mode={form.mode} values={form.values} categories={form.categories} errors={errors} onChange={(values) => onChange({ ...form, values })} />;
  }
  return <AiDepartmentForm values={form.values} errors={errors} onChange={(values) => onChange({ ...form, values })} />;
}

/**
 * What a change will do, waiting for the user's click. Nothing is saved before Confirm.
 * A card with a form can be edited first; the server checks the edited values again.
 */
export function AiConfirmCard({ action, live, onConfirm, onCancel }: AiConfirmCardProps) {
  const { card } = action;
  const pending = action.status === 'pending';
  const [editing, setEditing] = useState(Boolean(card.incomplete));
  const [form, setForm] = useState<AiCardForm | undefined>(card.form);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A document's or a receipt's file: chosen on the card, sent with the Confirm click.
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // A claim's receipt follows the form: it turns required as the amount and category change.
  const needsFile = form?.kind === 'claim' ? claimNeedsReceipt(form.values, form.categories) : Boolean(card.file?.required);
  const confirmLabel = form?.kind === 'claim' ? (form.values.submitNow ? 'Submit claim' : form.mode === 'create' ? 'Save as draft' : 'Save expense') : card.confirmLabel;
  const pick = (picked: File) => {
    const problem = fileProblem(picked, card.file?.kind);
    setFileError(problem);
    setFile(problem ? null : picked);
  };
  const danger = card.tone === 'danger';
  const { token } = theme.useToken();

  const submit = async () => {
    setServerError(null);
    if (editing && form) {
      const problems = validate(form);
      setErrors(problems);
      if (Object.keys(problems).length) return;
    }
    if (needsFile && !file) {
      setFileError('Choose a file first.');
      return;
    }
    setBusy(true);
    const outcome = await onConfirm(editing ? form?.values : undefined, file ?? undefined);
    setBusy(false);
    if (!outcome.ok) {
      setServerError(outcome.error ?? 'Nothing was changed.');
      if (outcome.fieldErrors) {
        setErrors(outcome.fieldErrors);
        setEditing(Boolean(card.form));
      }
    }
  };

  return (
    <Card
      size="small"
      className="w-full"
      style={danger ? { borderColor: token.colorError } : undefined}
      title={<Typography.Text type={danger ? 'danger' : undefined} strong>{card.title}</Typography.Text>}
      extra={pending ? null : STATUS_TAGS[action.status as keyof typeof STATUS_TAGS]}
      data-testid="ai-confirm-card"
    >
      {editing && form ? (
        <CardForm form={form} errors={errors} onChange={setForm} />
      ) : (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {card.rows.map((row) => (
            <div key={row.label} className="contents">
              <dt style={{ color: token.colorTextSecondary }}>{row.label}</dt>
              <dd className="m-0">
                {row.previous !== undefined ? (
                  <>
                    <Typography.Text delete type="secondary">{row.previous}</Typography.Text> → <strong>{row.value}</strong>
                  </>
                ) : (
                  row.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {card.file && pending ? (
        <AiFileField
          file={file}
          error={fileError}
          current={card.file.current}
          disabled={busy}
          autoOpen={Boolean(live) && needsFile}
          kind={card.file.kind}
          optional={!needsFile}
          onPick={pick}
        />
      ) : null}

      {card.warnings?.length ? (
        <Alert className="!mt-2" type="warning" showIcon message={card.warnings.map((w) => <div key={w}>{w}</div>)} />
      ) : null}
      {card.notes?.map((note) => (
        <Typography.Paragraph key={note} type="secondary" className="!mb-0 !mt-2 text-xs">
          {note}
        </Typography.Paragraph>
      ))}
      {serverError ? <Alert className="!mt-2" type="error" showIcon message={serverError} /> : null}

      {pending ? (
        <Space className="mt-3" wrap>
          <Button type="primary" danger={danger} loading={busy} disabled={needsFile && !file} onClick={() => void submit()}>
            {confirmLabel}
          </Button>
          {card.form && !editing ? (
            <Button icon={<EditOutlined />} onClick={() => setEditing(true)} disabled={busy}>
              Edit
            </Button>
          ) : null}
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </Space>
      ) : null}
    </Card>
  );
}
