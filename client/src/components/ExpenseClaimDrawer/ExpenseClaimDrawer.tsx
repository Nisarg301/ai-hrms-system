import { CloseOutlined, CopyOutlined, DeleteOutlined, EditOutlined, FileOutlined, PaperClipOutlined, PlusOutlined, RollbackOutlined, SendOutlined } from '@ant-design/icons';
import { Alert, Button, Drawer, Empty, message, Space, Tag, theme, Tooltip, Typography, Upload } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { confirmAction } from '../ConfirmDialog/confirmDialog';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectExpenses } from '../../store/expenses/expensesSelectors';
import { closeClaim } from '../../store/expenses/expensesSlice';
import {
  addItem,
  copyClaim,
  deleteClaim,
  deleteItem,
  deleteReceipt,
  fetchExpenseCategories,
  renameClaim,
  submitClaim,
  updateItem,
  uploadReceipt,
  withdrawClaim,
} from '../../store/expenses/expensesThunks';
import type { FieldAwareError } from '../../store/thunkError';
import type { ExpenseClaimDetail, ExpenseItem, ExpenseItemPayload, SubmitProblem } from '../../types/expense';
import { CLAIM_STATUS_META } from '../../utils/expenseFormat';
import { formatInrExact } from '../../utils/formatInr';
import { ClaimTimeline, openReceipt } from './claimParts';
import { ExpenseItemForm } from './ExpenseItemForm';

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const RECEIPT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

/** The server's field errors as { field: first message }. */
function fieldErrorsOf(err: FieldAwareError | undefined): Record<string, string> {
  const fieldErrors = (err?.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors ?? {};
  return Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, v[0]]));
}

/** Runs a claim change, and says so if it fails. */
async function orSay<T extends { payload?: unknown }>(action: Promise<T>, isRejected: (a: T) => boolean, fallback: string) {
  const result = await action;
  if (isRejected(result)) void message.error((result.payload as FieldAwareError | undefined)?.message ?? fallback);
}

interface ItemRowProps {
  claim: ExpenseClaimDetail;
  item: ExpenseItem;
  editable: boolean;
  problem: string | null;
  onEdit: () => void;
}

function ItemRow({ claim, item, editable, problem, onEdit }: ItemRowProps) {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const [uploading, setUploading] = useState(false);

  const onUpload = async (file: File) => {
    if (!RECEIPT_TYPES.includes(file.type)) {
      void message.error('Receipts can be PDF, JPG or PNG');
      return;
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      void message.error('A receipt can be at most 10 MB');
      return;
    }
    setUploading(true);
    const result = await dispatch(uploadReceipt({ claimId: claim.id, itemId: item.id, file }));
    setUploading(false);
    if (uploadReceipt.rejected.match(result)) void message.error(result.payload?.message ?? 'Could not upload the receipt');
  };

  return (
    <li
      data-testid="expense-item"
      className="rounded-lg border p-3"
      style={{ borderColor: problem ? token.colorError : token.colorBorderSecondary, background: problem ? token.colorErrorBg : undefined }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{item.merchant}</div>
          <div className="text-xs" style={{ color: token.colorTextSecondary }}>
            {dayjs(item.date).format('ddd, D MMM YYYY')} · {item.categoryName ?? 'Unknown category'}
            {item.note ? ` · ${item.note}` : ''}
          </div>
          <Space size={4} wrap className="mt-1">
            {item.overLimit ? <Tag color="orange">Over limit</Tag> : null}
            {item.missingReceipt ? <Tag color="red">Receipt required</Tag> : null}
          </Space>
        </div>
        <div className="flex items-center gap-1">
          <span className="font-semibold tabular-nums">{formatInrExact(item.amountPaise)}</span>
          {editable ? (
            <>
              <Tooltip title="Edit">
                <Button type="text" size="small" icon={<EditOutlined />} aria-label={`Edit ${item.merchant}`} onClick={onEdit} />
              </Tooltip>
              <Tooltip title="Remove">
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  aria-label={`Remove ${item.merchant}`}
                  onClick={() => void orSay(dispatch(deleteItem({ claimId: claim.id, itemId: item.id })), deleteItem.rejected.match, 'Could not remove the expense')}
                />
              </Tooltip>
            </>
          ) : null}
        </div>
      </div>
      {problem ? <div className="mt-2 text-sm" style={{ color: token.colorError }}>{problem}</div> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {item.receipts.map((r) => (
          <Tag
            key={r.id}
            icon={<FileOutlined />}
            className="!mr-0"
            closable={editable}
            closeIcon={editable ? <CloseOutlined aria-label={`Remove ${r.originalName}`} /> : undefined}
            onClose={(e) => {
              e.preventDefault();
              void orSay(dispatch(deleteReceipt({ claimId: claim.id, itemId: item.id, fileId: r.id })), deleteReceipt.rejected.match, 'Could not remove the receipt');
            }}
          >
            <button type="button" className="cursor-pointer border-0 bg-transparent p-0 underline" onClick={() => openReceipt(claim.id, item.id, r)}>
              {r.originalName}
            </button>
          </Tag>
        ))}
        {editable && item.receipts.length < 5 ? (
          <Upload
            accept=".pdf,.jpg,.jpeg,.png"
            showUploadList={false}
            beforeUpload={(file) => {
              void onUpload(file);
              return false;
            }}
          >
            <Button size="small" icon={<PaperClipOutlined />} loading={uploading} aria-label={`Add receipt for ${item.merchant}`}>
              Add receipt
            </Button>
          </Upload>
        ) : null}
      </div>
    </li>
  );
}

/** A claim: an editor while it's a draft, then a read-only view with its timeline. */
export function ExpenseClaimDrawer() {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const { current: claim, categories } = useAppSelector(selectExpenses);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<SubmitProblem[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const claimId = claim?.id;
  useEffect(() => {
    if (!claimId) return;
    void dispatch(fetchExpenseCategories());
    setAdding(false);
    setEditing(null);
    setProblems([]);
    setSubmitError(null);
  }, [claimId, dispatch]);

  if (!claim) return <Drawer open={false} />;
  const isDraft = claim.status === 'draft';
  const meta = CLAIM_STATUS_META[claim.status];
  const problemFor = (itemId: string) => problems.find((p) => p.itemId === itemId)?.message ?? null;

  const saveItem = async (payload: ExpenseItemPayload) => {
    setSaving(true);
    setServerErrors({});
    const result = editing
      ? await dispatch(updateItem({ claimId: claim.id, itemId: editing, payload }))
      : await dispatch(addItem({ claimId: claim.id, payload }));
    setSaving(false);
    if (addItem.rejected.match(result) || updateItem.rejected.match(result)) {
      const errors = fieldErrorsOf(result.payload);
      setServerErrors(errors);
      if (!Object.keys(errors).length) void message.error(result.payload?.message ?? 'Could not save the expense');
      return;
    }
    setAdding(false);
    setEditing(null);
    setProblems([]);
  };

  const onSubmit = async () => {
    setBusy(true);
    setSubmitError(null);
    setProblems([]);
    const result = await dispatch(submitClaim(claim.id));
    setBusy(false);
    if (submitClaim.rejected.match(result)) {
      setSubmitError(result.payload?.message ?? 'Could not submit the claim');
      setProblems((result.payload?.details as { problems?: SubmitProblem[] } | undefined)?.problems ?? []);
      return;
    }
    void message.success(`Submitted as ${result.payload.number}. Your admin has been notified.`);
  };

  const onWithdraw = () =>
    confirmAction({
      title: 'Withdraw this claim?',
      content: 'It goes back to a draft so you can change it. You can submit it again with the same number.',
      okText: 'Withdraw',
      onConfirm: async () => {
        const result = await dispatch(withdrawClaim(claim.id));
        if (withdrawClaim.rejected.match(result)) void message.error(result.payload?.message ?? 'Could not withdraw');
      },
    });

  const onCopy = async () => {
    setBusy(true);
    const result = await dispatch(copyClaim(claim.id));
    setBusy(false);
    if (copyClaim.rejected.match(result)) void message.error(result.payload?.message ?? 'Could not copy');
    else void message.success('Copied to a new draft');
  };

  const onDelete = () =>
    confirmAction({
      title: 'Delete this draft?',
      content: 'Its expenses and receipts will be removed.',
      okText: 'Delete',
      onConfirm: async () => {
        await dispatch(deleteClaim(claim.id));
      },
    });

  const editingItem = claim.items.find((i) => i.id === editing) ?? null;

  return (
    <Drawer
      open
      width={760}
      onClose={() => dispatch(closeClaim())}
      destroyOnHidden
      title={
        <div className="flex flex-wrap items-center gap-2">
          <span>{claim.number ?? 'New claim'}</span>
          <Tag color={meta.color} className="!mr-0">
            {meta.label}
          </Tag>
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span style={{ color: token.colorTextSecondary }}>Total </span>
            <span className="text-lg font-semibold tabular-nums" data-testid="claim-total">
              {formatInrExact(claim.totalPaise)}
            </span>
          </div>
          <Space wrap>
            {isDraft ? (
              <>
                <Button danger icon={<DeleteOutlined />} onClick={onDelete}>
                  Delete draft
                </Button>
                <Button type="primary" icon={<SendOutlined />} loading={busy} disabled={claim.items.length === 0} onClick={onSubmit}>
                  Submit
                </Button>
              </>
            ) : (
              <>
                {claim.status === 'submitted' ? (
                  <Button icon={<RollbackOutlined />} onClick={onWithdraw}>
                    Withdraw
                  </Button>
                ) : null}
                <Button icon={<CopyOutlined />} loading={busy} onClick={onCopy}>
                  Copy to new claim
                </Button>
              </>
            )}
          </Space>
        </div>
      }
    >
      <Typography.Title
        level={4}
        className="!mt-0"
        editable={
          isDraft
            ? {
                maxLength: 120,
                tooltip: 'Rename',
                onChange: (title) => {
                  if (!title.trim() || title.trim() === claim.title) return;
                  void orSay(dispatch(renameClaim({ id: claim.id, title: title.trim() })), renameClaim.rejected.match, 'Could not rename the claim');
                },
              }
            : false
        }
      >
        {claim.title}
      </Typography.Title>

      {!isDraft ? <ClaimTimeline claim={claim} /> : null}
      {submitError ? <Alert className="mb-3" type="error" showIcon message={submitError} /> : null}

      {claim.items.length === 0 && !adding ? (
        <Empty description="No expenses yet. Add the first one." image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <ul className="m-0 mb-3 flex list-none flex-col gap-2 p-0" aria-label="Expenses">
          {claim.items.map((item) =>
            editing === item.id ? (
              <li key={item.id}>
                <ExpenseItemForm categories={categories} initial={editingItem} saving={saving} serverErrors={serverErrors} onSave={saveItem} onCancel={() => setEditing(null)} />
              </li>
            ) : (
              <ItemRow
                key={item.id}
                claim={claim}
                item={item}
                editable={isDraft}
                problem={problemFor(item.id)}
                onEdit={() => {
                  setAdding(false);
                  setServerErrors({});
                  setEditing(item.id);
                }}
              />
            )
          )}
        </ul>
      )}

      {isDraft ? (
        adding ? (
          <ExpenseItemForm categories={categories} saving={saving} serverErrors={serverErrors} onSave={saveItem} onCancel={() => setAdding(false)} />
        ) : claim.items.length < 20 ? (
          <Button
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              setServerErrors({});
              setAdding(true);
            }}
          >
            Add expense
          </Button>
        ) : (
          <Alert type="info" showIcon message="A claim can have at most 20 expenses. Start another claim for the rest." />
        )
      ) : null}
    </Drawer>
  );
}
