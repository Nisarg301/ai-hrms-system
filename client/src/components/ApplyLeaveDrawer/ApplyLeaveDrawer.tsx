import { CheckCircleFilled, InfoCircleFilled } from '@ant-design/icons';
import { Alert, Button, DatePicker, Drawer, Form, Input, message, Radio, Segmented, Select, Spin, theme } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { getMyBalancesRequest, previewLeaveRequest } from '../../services/endpoints/leave.endpoints';
import { selectMyBalances } from '../../store/leave/leaveSelectors';
import { applyLeave, fetchMyBalances, refreshAfterLeaveChange } from '../../store/leave/leaveThunks';
import { fetchLeaveRequests, recordLeave } from '../../store/leaveAdmin/leaveAdminThunks';
import { selectPeople } from '../../store/team/teamSelectors';
import { fetchPeople } from '../../store/team/teamThunks';
import { ApiError, type ValidationDetails } from '../../types/api';
import type { HalfDay, LeaveBalance, LeaveInput } from '../../types/leave';

// Shown as "05 Oct 2026"; typing "2026-10-05" works too.
const DATE_FORMATS = ['DD MMM YYYY', 'YYYY-MM-DD'];

/** How far back an ORG_ADMIN can record leave (the server's MAX_BACKDATE_DAYS). */
export const MAX_BACKDATE_DAYS = 30;

type Preview =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ok'; days: number; availableAfter: number | null }
  | { state: 'invalid'; message: string };

/** The server's reason, e.g. "This overlaps your pending leave on …", rather than "Validation failed". */
export function leaveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const fieldErrors = (error.details as ValidationDetails | undefined)?.fieldErrors;
    const first = fieldErrors ? Object.values(fieldErrors).flat()[0] : undefined;
    return first ?? error.message;
  }
  return 'Something went wrong';
}

function days(n: number): string {
  const value = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${value} working day${n === 1 ? '' : 's'}`;
}

export function availableLabel(b: LeaveBalance): string {
  return b.available === null ? 'Unlimited' : `${b.available} available`;
}

interface ApplyLeaveDrawerProps {
  open: boolean;
  onClose: () => void;
  /**
   * 'apply' (default): my own leave, from today on, for an admin to approve.
   * 'record': an ORG_ADMIN records leave for an employee (e.g. an emergency);
   * it can be up to 30 days back and is approved straight away.
   */
  mode?: 'apply' | 'record';
}

export function ApplyLeaveDrawer({ open, onClose, mode = 'apply' }: ApplyLeaveDrawerProps) {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const recording = mode === 'record';
  const myBalances = useAppSelector(selectMyBalances);
  const people = useAppSelector(selectPeople);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employeeBalances, setEmployeeBalances] = useState<LeaveBalance[]>([]);
  const balances = recording ? employeeBalances : myBalances;
  const employeeName = people.find((p) => p.id === employeeId)?.name ?? 'The employee';
  // Your own leave starts today at the earliest; a recording can go back 30 days.
  const earliest = recording ? dayjs().subtract(MAX_BACKDATE_DAYS, 'day') : dayjs();
  const beforeEarliest = (d: dayjs.Dayjs) => d.isBefore(earliest, 'day');
  // The pickers grey out earlier days, but a typed date + Enter still gets through; drop it here.
  const pick = (d: dayjs.Dayjs | null) => (d && !beforeEarliest(d) ? d.format('YYYY-MM-DD') : null);

  const [leaveTypeId, setLeaveTypeId] = useState<string | null>(null);
  const [dayMode, setDayMode] = useState<'full' | 'half'>('full');
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [halfDay, setHalfDay] = useState<HalfDay>('first');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Preview>({ state: 'idle' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (recording) {
      void dispatch(fetchPeople());
      setEmployeeId(null);
      setEmployeeBalances([]);
    } else {
      void dispatch(fetchMyBalances());
    }
    setDayMode('full');
    setStartDate(null);
    setEndDate(null);
    setHalfDay('first');
    setReason('');
    setPreview({ state: 'idle' });
  }, [open, recording, dispatch]);

  // Recording: the chosen employee's balances drive the type list.
  useEffect(() => {
    if (!open || !recording || !employeeId) return;
    let current = true;
    getMyBalancesRequest(employeeId)
      .then(({ data }) => current && setEmployeeBalances(data))
      .catch((err) => current && setPreview({ state: 'invalid', message: leaveErrorMessage(err) }));
    return () => {
      current = false;
    };
  }, [open, recording, employeeId]);

  // Default to the first type once balances arrive (or if the chosen one disappeared).
  useEffect(() => {
    if (balances.length && !balances.some((b) => b.leaveTypeId === leaveTypeId)) {
      setLeaveTypeId(balances[0].leaveTypeId);
    }
  }, [balances, leaveTypeId]);

  const selectedType = balances.find((b) => b.leaveTypeId === leaveTypeId) ?? null;
  const halfAllowed = selectedType?.allowHalfDay ?? false;
  const isHalf = dayMode === 'half' && halfAllowed;

  const input: LeaveInput | null = useMemo(() => {
    if (!leaveTypeId || !startDate || (recording && !employeeId)) return null;
    if (isHalf) return { leaveTypeId, startDate, endDate: startDate, halfDay };
    return endDate ? { leaveTypeId, startDate, endDate, halfDay: null } : null;
  }, [leaveTypeId, startDate, endDate, isHalf, halfDay, recording, employeeId]);

  // The preview runs the server's own checks, 300 ms after the last change.
  const inputKey = input ? JSON.stringify({ input, employeeId: recording ? employeeId : undefined }) : '';
  const debouncedKey = useDebouncedValue(inputKey, 300);
  useEffect(() => {
    if (!open || !debouncedKey) {
      setPreview({ state: 'idle' });
      return;
    }
    let current = true;
    setPreview({ state: 'loading' });
    const key = JSON.parse(debouncedKey) as { input: LeaveInput; employeeId?: string };
    previewLeaveRequest(key.input, key.employeeId)
      .then(({ data }) => current && setPreview({ state: 'ok', days: data.days, availableAfter: data.availableAfter }))
      .catch((err) => current && setPreview({ state: 'invalid', message: leaveErrorMessage(err) }));
    return () => {
      current = false;
    };
  }, [debouncedKey, open]);

  // Only a preview of exactly what's on screen counts.
  const ready = preview.state === 'ok' && debouncedKey === inputKey;

  const onSubmit = async () => {
    if (!input || !ready) return;
    setSubmitting(true);
    const payload = { ...input, reason: reason.trim() };
    const result = recording && employeeId ? await dispatch(recordLeave({ ...payload, employeeId })) : await dispatch(applyLeave(payload));
    setSubmitting(false);
    if (applyLeave.rejected.match(result) || recordLeave.rejected.match(result)) {
      const p = result.payload;
      const error = p ? new ApiError(p.status, p.message, p.details) : new ApiError(0, 'Could not save the leave');
      setPreview({ state: 'invalid', message: leaveErrorMessage(error) });
      return;
    }
    if (recording) {
      void message.success(`Leave recorded and approved. ${employeeName} has been emailed.`);
      void dispatch(fetchLeaveRequests());
    } else {
      void message.success('Leave applied. Your admin has been notified.');
    }
    void dispatch(refreshAfterLeaveChange());
    onClose();
  };

  const onStartChange = (value: string | null) => {
    setStartDate(value);
    // Keep the range sensible: a later start pulls the end along with it.
    if (value && (!endDate || endDate < value)) setEndDate(value);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={recording ? 'Record leave for an employee' : 'Apply for leave'}
      width={440}
      destroyOnHidden
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" disabled={!ready} loading={submitting} onClick={onSubmit}>
            {recording ? 'Record & approve' : 'Apply'}
          </Button>
        </div>
      }
    >
      <Form layout="vertical">
        {recording ? (
          <>
            <Alert
              className="mb-4"
              type="info"
              showIcon
              message="For when someone couldn't apply themselves, such as an emergency. It's approved straight away and they're emailed. It can be up to 30 days in the past."
            />
            <Form.Item label="Employee" htmlFor="leave-employee">
              <Select
                id="leave-employee"
                showSearch
                optionFilterProp="label"
                placeholder="Choose who is on leave"
                value={employeeId ?? undefined}
                onChange={(v) => {
                  setEmployeeId(v);
                  setEmployeeBalances([]);
                  setLeaveTypeId(null);
                }}
                options={people.map((p) => ({ value: p.id, label: p.jobTitle ? `${p.name} · ${p.jobTitle}` : p.name }))}
              />
            </Form.Item>
          </>
        ) : null}
        <Form.Item label="Leave type" htmlFor="leave-type">
          <Select
            id="leave-type"
            value={leaveTypeId ?? undefined}
            onChange={setLeaveTypeId}
            loading={balances.length === 0 && (!recording || Boolean(employeeId))}
            disabled={recording && !employeeId}
            options={balances.map((b) => ({
              value: b.leaveTypeId,
              label: (
                <span className="flex justify-between gap-2">
                  <span>{b.name}</span>
                  <span style={{ color: token.colorTextSecondary }}>{availableLabel(b)}</span>
                </span>
              ),
            }))}
          />
        </Form.Item>

        {halfAllowed ? (
          <Form.Item>
            <Segmented
              block
              value={dayMode}
              onChange={(v) => setDayMode(v as 'full' | 'half')}
              options={[
                { label: 'Full day(s)', value: 'full' },
                { label: 'Half day', value: 'half' },
              ]}
            />
          </Form.Item>
        ) : null}

        {isHalf ? (
          <>
            <Form.Item label="Date" htmlFor="leave-date">
              <DatePicker
                id="leave-date"
                className="w-full"
                format={DATE_FORMATS}
                value={startDate ? dayjs(startDate) : null}
                disabledDate={beforeEarliest}
                onChange={(d) => setStartDate(pick(d))}
              />
            </Form.Item>
            <Form.Item>
              <Radio.Group value={halfDay} onChange={(e) => setHalfDay(e.target.value)}>
                <Radio value="first">First half</Radio>
                <Radio value="second">Second half</Radio>
              </Radio.Group>
            </Form.Item>
          </>
        ) : (
          <div className="flex gap-3">
            <Form.Item label="From" htmlFor="leave-from" className="flex-1">
              <DatePicker
                id="leave-from"
                className="w-full"
                format={DATE_FORMATS}
                value={startDate ? dayjs(startDate) : null}
                disabledDate={beforeEarliest}
                onChange={(d) => onStartChange(pick(d))}
              />
            </Form.Item>
            <Form.Item label="To" htmlFor="leave-to" className="flex-1">
              <DatePicker
                id="leave-to"
                className="w-full"
                format={DATE_FORMATS}
                value={endDate ? dayjs(endDate) : null}
                disabledDate={(d) => beforeEarliest(d) || (Boolean(startDate) && d.isBefore(dayjs(startDate), 'day'))}
                onChange={(d) => setEndDate(pick(d))}
              />
            </Form.Item>
          </div>
        )}

        <div className="mb-4 min-h-[56px]" aria-live="polite" data-testid="leave-preview">
          {preview.state === 'loading' ? (
            <div className="flex items-center gap-2 py-2" style={{ color: token.colorTextSecondary }}>
              <Spin size="small" /> Counting working days…
            </div>
          ) : preview.state === 'ok' ? (
            <div className="flex items-start gap-2 rounded-lg p-3" style={{ background: token.colorSuccessBg }}>
              <CheckCircleFilled style={{ color: token.colorSuccess, marginTop: 4 }} />
              <div>
                <strong>{days(preview.days)}</strong>
                {preview.availableAfter !== null ? <> · {preview.availableAfter} left after this</> : null}
                <div className="text-xs" style={{ color: token.colorTextSecondary }}>
                  Weekends and holidays aren't counted.
                </div>
              </div>
            </div>
          ) : preview.state === 'invalid' ? (
            <Alert type="error" showIcon message={preview.message} />
          ) : (
            <div className="flex items-center gap-2 py-2 text-sm" style={{ color: token.colorTextSecondary }}>
              <InfoCircleFilled /> Pick your dates to see how many days this uses.
            </div>
          )}
        </div>

        <Form.Item label="Reason (optional)" htmlFor="leave-reason">
          <Input.TextArea id="leave-reason" rows={3} maxLength={500} showCount value={reason} onChange={(e) => setReason(e.target.value)} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
