import { Alert, Button, DatePicker, Form, Input, Modal } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { useAppDispatch } from '../../hooks/store';
import { payClaims } from '../../store/expensesAdmin/expensesAdminThunks';
import type { ExpenseClaim, PayResult } from '../../types/expense';
import { formatInrExact } from '../../utils/formatInr';

interface PayClaimsModalProps {
  /** The approved claims to record as paid; null = closed. */
  claims: ExpenseClaim[] | null;
  onClose: () => void;
  /** After the server answered (something may have been paid): refresh. */
  onPaid: () => void;
}

/**
 * Records a payment made outside the app (a bank transfer, say) for one or more approved claims.
 * Claims someone else already paid are skipped, and the result says which and why.
 */
export function PayClaimsModal({ claims, onClose, onPaid }: PayClaimsModalProps) {
  const dispatch = useAppDispatch();
  const [paidOn, setPaidOn] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<PayResult | null>(null);

  const open = Boolean(claims?.length);
  useEffect(() => {
    if (!open) return;
    setPaidOn(dayjs().format('YYYY-MM-DD'));
    setReference('');
    setErrors({});
    setServerError(null);
    setResult(null);
  }, [open]);

  if (!claims?.length) return null;
  const total = claims.reduce((sum, c) => sum + c.totalPaise, 0);
  const future = (d: Dayjs) => d.isAfter(dayjs(), 'day');

  const onOk = async () => {
    const problems: Record<string, string> = {};
    if (!paidOn) problems.paidOn = 'Choose the payment date';
    if (!reference.trim()) problems.reference = 'Enter the payment reference (e.g. the UTR)';
    setErrors(problems);
    if (Object.keys(problems).length) return;

    setSaving(true);
    setServerError(null);
    const response = await dispatch(payClaims({ claimIds: claims.map((c) => c.id), paidOn: paidOn!, reference: reference.trim() }));
    setSaving(false);
    if (payClaims.rejected.match(response)) {
      const fieldErrors = (response.payload?.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors ?? {};
      const known = Object.fromEntries(['paidOn', 'reference'].filter((f) => fieldErrors[f]).map((f) => [f, fieldErrors[f][0]]));
      setErrors(known);
      if (!Object.keys(known).length) setServerError(response.payload?.message ?? 'Could not record the payment');
      return;
    }
    onPaid();
    setResult(response.payload);
  };

  if (result) {
    const n = result.paid.length;
    return (
      <Modal
        open
        title="Payment recorded"
        onCancel={onClose}
        footer={
          <Button type="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <p data-testid="pay-result">
          {n ? `Marked ${n} claim${n === 1 ? '' : 's'} as paid · ${formatInrExact(result.totalPaidPaise)}.` : 'Nothing was marked as paid.'}
          {n ? ' Each employee has been told.' : ''}
        </p>
        {result.skipped.length ? (
          <Alert
            type="warning"
            showIcon
            message={`Skipped ${result.skipped.length}`}
            description={
              <ul className="m-0 pl-4">
                {result.skipped.map((s) => (
                  <li key={s.id}>
                    {s.number ?? 'A claim'}: {s.reason}
                  </li>
                ))}
              </ul>
            }
          />
        ) : null}
      </Modal>
    );
  }

  return (
    <Modal open title="Mark as paid" okText="Mark as paid" onOk={onOk} confirmLoading={saving} onCancel={onClose} destroyOnHidden>
      <p>
        {claims.length === 1 ? `${claims[0].number} · ${claims[0].employeeName ?? 'Former member'}` : `${claims.length} claims`} ·{' '}
        <strong>{formatInrExact(total)}</strong>
      </p>
      <p className="text-sm opacity-80">Pay them from your bank first; this records the payment and tells each employee.</p>
      {serverError ? <Alert className="mb-3" type="error" showIcon message={serverError} /> : null}
      <Form layout="vertical">
        <Form.Item label="Paid on" htmlFor="pay-date" validateStatus={errors.paidOn ? 'error' : ''} help={errors.paidOn}>
          <DatePicker
            id="pay-date"
            className="w-full"
            format={['DD MMM YYYY', 'YYYY-MM-DD']}
            disabledDate={future}
            value={paidOn ? dayjs(paidOn) : null}
            // Typed dates get past disabledDate on Enter, so check here too.
            onChange={(d) => setPaidOn(d && !future(d) ? d.format('YYYY-MM-DD') : null)}
          />
        </Form.Item>
        <Form.Item label="Payment reference" htmlFor="pay-reference" validateStatus={errors.reference ? 'error' : ''} help={errors.reference ?? 'The bank UTR, or a cheque number.'}>
          <Input id="pay-reference" maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
