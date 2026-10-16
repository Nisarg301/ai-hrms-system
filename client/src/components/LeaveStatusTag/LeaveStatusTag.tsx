import { Tag } from 'antd';
import type { LeaveStatus } from '../../types/leave';

const COLORS: Record<LeaveStatus, string> = {
  pending: 'gold',
  approved: 'green',
  rejected: 'red',
  cancelled: 'default',
};

const LABELS: Record<LeaveStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export function LeaveStatusTag({ status }: { status: LeaveStatus }) {
  return <Tag color={COLORS[status]}>{LABELS[status]}</Tag>;
}
