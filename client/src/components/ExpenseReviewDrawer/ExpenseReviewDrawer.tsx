import { CheckOutlined, CloseOutlined, WalletOutlined } from '@ant-design/icons';
import { Alert, Button, Drawer, Input, message, Space, Tag, theme } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectExpensesAdmin } from '../../store/expensesAdmin/expensesAdminSelectors';
import { closeAdminClaim } from '../../store/expensesAdmin/expensesAdminSlice';
import { decideClaim, openAdminClaim } from '../../store/expensesAdmin/expensesAdminThunks';
import type { ExpenseClaim, ExpenseItem } from '../../types/expense';
import { CLAIM_STATUS_META } from '../../utils/expenseFormat';
import { formatInrExact } from '../../utils/formatInr';
import { ClaimTimeline, ReceiptPreview } from '../ExpenseClaimDrawer/claimParts';

interface ExpenseReviewDrawerProps {
  /** After a decision (or a stale one): refresh the list and the badge. */
  onChanged: () => void;
  /** Offered on an approved claim when given. */
  onPay?: (claim: ExpenseClaim) => void;
}

function ReviewItem({ claimId, item }: { claimId: string; item: ExpenseItem }) {
  const { token } = theme.useToken();
  return (
    <li data-testid="review-item" className="rounded-lg border p-3" style={{ borderColor: item.overLimit ? token.colorWarningBorder : token.colorBorderSecondary }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{item.merchant}</div>
          <div className="text-xs" style={{ color: token.colorTextSecondary }}>
            {dayjs(item.date).format('ddd, D MMM YYYY')} · {item.categoryName ?? 'Unknown category'}
          </div>
          {item.note ? <div className="mt-1 text-sm">{item.note}</div> : null}
          {item.overLimit ? (
            <Tag color="orange" className="mt-1">
              Over limit
            </Tag>
          ) : null}
        </div>
        <span className="font-semibold tabular-nums">{formatInrExact(item.amountPaise)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        {item.receipts.length ? (
          item.receipts.map((r) => <ReceiptPreview key={r.id} claimId={claimId} itemId={item.id} receipt={r} />)
        ) : (
          <span className="text-xs" style={{ color: token.colorTextSecondary }}>
            No receipt
          </span>
        )}
      </div>
    </li>
  );
}

/** ORG_ADMIN reviews a claim: its expenses and receipts, then approves or rejects it (a note is required to reject). */
export function ExpenseReviewDrawer({ onChanged, onPay }: ExpenseReviewDrawerProps) {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const { current: claim } = useAppSelector(selectExpensesAdmin);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'approve' | 'reject' | null>(null);

  const claimId = claim?.id;
  useEffect(() => {
    setNote('');
    setNoteError(null);
  }, [claimId]);

  if (!claim) return <Drawer open={false} />;
  const meta = CLAIM_STATUS_META[claim.status];
  const employee = claim.employeeName ?? 'This employee';
  const overLimit = claim.items.filter((i) => i.overLimit).length;
  const close = () => dispatch(closeAdminClaim());

  const decide = async (action: 'approve' | 'reject') => {
    if (action === 'reject' && !note.trim()) {
      setNoteError('Say why, so they can fix it');
      return;
    }
    setNoteError(null);
    setSaving(action);
    const result = await dispatch(decideClaim({ id: claim.id, action, note: note.trim() }));
    setSaving(null);
    if (decideClaim.rejected.match(result)) {
      const fieldErrors = (result.payload?.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors;
      if (fieldErrors?.note) {
        setNoteError(fieldErrors.note[0]);
        return;
      }
      // e.g. "This claim is already approved": another admin got there first, or it was withdrawn.
      void message.error(result.payload?.message ?? 'Could not save the decision');
      void dispatch(openAdminClaim(claim.id));
      onChanged();
      return;
    }
    void message.success(`${action === 'approve' ? 'Approved' : 'Rejected'} ${claim.number} for ${employee}`);
    onChanged();
    close();
  };

  return (
    <Drawer
      open
      width={760}
      onClose={close}
      destroyOnHidden
      title={
        <div className="flex flex-wrap items-center gap-2">
          <span>{claim.number}</span>
          <Tag color={meta.color} className="!mr-0">
            {meta.label}
          </Tag>
        </div>
      }
      footer={
        <div className="flex flex-col gap-3">
          {claim.status === 'submitted' ? (
            <div>
              <label htmlFor="expense-decision-note" className="mb-1 block">
                Note to {employee} (required to reject)
              </label>
              <Input.TextArea
                id="expense-decision-note"
                rows={2}
                maxLength={500}
                showCount
                status={noteError ? 'error' : undefined}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  if (noteError) setNoteError(null);
                }}
                placeholder="e.g. Please add the hotel bill for 12 Sep."
              />
              {noteError ? (
                <div className="mt-1 text-sm" style={{ color: token.colorError }}>
                  {noteError}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span style={{ color: token.colorTextSecondary }}>Total </span>
              <span className="text-lg font-semibold tabular-nums" data-testid="review-total">
                {formatInrExact(claim.totalPaise)}
              </span>
            </div>
            <Space wrap>
              {claim.status === 'submitted' ? (
                <>
                  <Button danger icon={<CloseOutlined />} loading={saving === 'reject'} disabled={saving === 'approve'} onClick={() => decide('reject')}>
                    Reject
                  </Button>
                  <Button type="primary" icon={<CheckOutlined />} loading={saving === 'approve'} disabled={saving === 'reject'} onClick={() => decide('approve')}>
                    Approve
                  </Button>
                </>
              ) : null}
              {claim.status === 'approved' && onPay ? (
                <Button type="primary" icon={<WalletOutlined />} onClick={() => onPay(claim)}>
                  Mark as paid
                </Button>
              ) : null}
            </Space>
          </div>
        </div>
      }
    >
      <div className="mb-3">
        <div className="text-lg font-semibold">{claim.title}</div>
        <div style={{ color: token.colorTextSecondary }}>
          {employee} · {claim.itemCount} expense{claim.itemCount === 1 ? '' : 's'}
        </div>
      </div>
      {overLimit ? (
        <Alert
          className="mb-3"
          type="warning"
          showIcon
          message={`${overLimit} expense${overLimit === 1 ? ' is' : 's are'} over the category limit. You can still approve.`}
        />
      ) : null}
      <ClaimTimeline claim={claim} />
      <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Expenses">
        {claim.items.map((item) => (
          <ReviewItem key={item.id} claimId={claim.id} item={item} />
        ))}
      </ul>
    </Drawer>
  );
}
