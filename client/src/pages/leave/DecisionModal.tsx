import { Alert, Input, message, Modal } from 'antd';
import { useEffect, useState } from 'react';
import { useAppDispatch } from '../../hooks/store';
import { decideLeave, fetchLeaveRequests } from '../../store/leaveAdmin/leaveAdminThunks';
import type { AdminLeaveRequestRow } from '../../types/leave';
import { formatDays, formatLeaveDates } from '../../utils/leaveFormat';

export interface Decision {
  row: AdminLeaveRequestRow;
  action: 'approve' | 'reject';
}

/** Confirms an approval or rejection, with an optional note that goes to the employee. */
export function DecisionModal({ decision, onClose }: { decision: Decision | null; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (decision) setNote('');
  }, [decision]);

  if (!decision) return null;
  const { row, action } = decision;
  const approving = action === 'approve';

  const onOk = async () => {
    setSaving(true);
    const result = await dispatch(decideLeave({ id: row.id, action, note: note.trim() }));
    setSaving(false);
    if (decideLeave.rejected.match(result)) {
      // e.g. "This request is already approved" when another admin got there first.
      void message.error(result.payload ?? 'Could not save the decision');
      void dispatch(fetchLeaveRequests());
    } else {
      void message.success(approving ? `Approved ${row.employeeName ?? 'the'}'s leave` : `Rejected ${row.employeeName ?? 'the'}'s leave`);
    }
    onClose();
  };

  return (
    <Modal
      open
      title={approving ? 'Approve leave?' : 'Reject leave?'}
      okText={approving ? 'Approve' : 'Reject'}
      okButtonProps={{ danger: !approving }}
      confirmLoading={saving}
      onOk={onOk}
      onCancel={onClose}
    >
      <p>
        <strong>{row.employeeName ?? 'This employee'}</strong> · {row.leaveTypeName ?? 'Leave'} · {formatLeaveDates(row.startDate, row.endDate, row.halfDay)} (
        {formatDays(row.days)} {row.days === 1 ? 'day' : 'days'})
      </p>
      {row.reason ? <p className="italic opacity-80">“{row.reason}”</p> : null}
      {approving && row.availableAfter !== null && row.availableAfter < 0 ? (
        <Alert className="mb-3" type="warning" showIcon message="This is more than their remaining balance, so the approval will be refused." />
      ) : null}
      <label htmlFor="decision-note" className="mb-1 block">
        Note to {row.employeeName ?? 'the employee'} (optional)
      </label>
      <Input.TextArea
        id="decision-note"
        rows={3}
        maxLength={500}
        showCount
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={approving ? 'Enjoy your time off!' : 'e.g. We have a release that week. Could you pick other dates?'}
      />
    </Modal>
  );
}
