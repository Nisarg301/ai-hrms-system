import {
  Alert,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  message,
  Select,
  TimePicker,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../hooks/store";
import {
  createAttendanceRequest,
  refreshMyAttendance,
} from "../../store/attendance/attendanceThunks";
import {
  fetchAttendanceRequests,
  fetchTeamDay,
  recordFix,
} from "../../store/attendanceAdmin/attendanceAdminThunks";
import { selectPeople } from "../../store/team/teamSelectors";
import { fetchPeople } from "../../store/team/teamThunks";
import { ApiError } from "../../types/api";
import { leaveErrorMessage } from "../ApplyLeaveDrawer/ApplyLeaveDrawer";

const DATE_FORMATS = ["DD MMM YYYY", "YYYY-MM-DD"];
/** How far back each can go (the server's rules). */
const FIX_BACK_DAYS = 30;
const WFH_BACK_DAYS = 7;

export type AttendanceRequestMode = "fix" | "wfh" | "record";

interface AttendanceRequestDrawerProps {
  open: boolean;
  mode: AttendanceRequestMode;
  onClose: () => void;
  /** Pre-fills the date (a day clicked in the calendar). */
  initialDate?: string | null;
}

const TITLES: Record<AttendanceRequestMode, string> = {
  fix: "Request an attendance fix",
  wfh: "Request work from home",
  record: "Fix someone's attendance",
};

export function AttendanceRequestDrawer({
  open,
  mode,
  onClose,
  initialDate = null,
}: AttendanceRequestDrawerProps) {
  const dispatch = useAppDispatch();
  const people = useAppSelector(selectPeople);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [clockIn, setClockIn] = useState<string | null>(null);
  const [clockOut, setClockOut] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmployeeId(null);
    setDate(initialDate);
    setEndDate(initialDate);
    setClockIn(null);
    setClockOut(null);
    setReason("");
    setError(null);
    if (mode === "record") void dispatch(fetchPeople());
  }, [open, mode, initialDate, dispatch]);

  const today = dayjs();
  const earliest = today.subtract(
    mode === "wfh" ? WFH_BACK_DAYS : FIX_BACK_DAYS,
    "day",
  );
  // Fixes are for days that have happened; WFH can be planned ahead.
  const outOfRange = (d: Dayjs) =>
    d.isBefore(earliest, "day") || (mode !== "wfh" && d.isAfter(today, "day"));
  // Typed dates get past disabledDate on Enter, so check here too.
  const pick = (d: Dayjs | null) =>
    d && !outOfRange(d) ? d.format("YYYY-MM-DD") : null;

  const isFix = mode !== "wfh";
  const timesOk =
    !isFix || (clockIn !== null && clockOut !== null && clockOut > clockIn);
  const ready =
    Boolean(date) &&
    (isFix ? timesOk : Boolean(endDate) && endDate! >= date!) &&
    (mode !== "record" || Boolean(employeeId));

  const onSubmit = async () => {
    if (!ready || !date) return;
    setSaving(true);
    setError(null);
    const result =
      mode === "record"
        ? await dispatch(
            recordFix({
              employeeId: employeeId!,
              date,
              clockIn: clockIn!,
              clockOut: clockOut!,
              reason: reason.trim(),
            }),
          )
        : await dispatch(
            createAttendanceRequest(
              mode === "fix"
                ? {
                    kind: "regularization",
                    date,
                    clockIn: clockIn!,
                    clockOut: clockOut!,
                    reason: reason.trim(),
                  }
                : {
                    kind: "wfh",
                    startDate: date,
                    endDate: endDate!,
                    reason: reason.trim(),
                  },
            ),
          );
    setSaving(false);
    if (
      recordFix.rejected.match(result) ||
      createAttendanceRequest.rejected.match(result)
    ) {
      const p = result.payload;
      setError(
        leaveErrorMessage(
          p
            ? new ApiError(p.status, p.message, p.details)
            : new ApiError(0, "Could not save"),
        ),
      );
      return;
    }
    if (mode === "record") {
      const name =
        people.find((p) => p.id === employeeId)?.name ?? "The employee";
      void message.success(`Attendance fixed. ${name} has been emailed.`);
      void dispatch(fetchTeamDay({}));
      void dispatch(
        fetchAttendanceRequests({ kind: "regularization", status: "pending" }),
      );
    } else {
      void message.success("Request sent. Your admin has been notified.");
      void dispatch(refreshMyAttendance());
    }
    onClose();
  };

  const timeField = (
    label: string,
    id: string,
    value: string | null,
    onChange: (v: string | null) => void,
  ) => (
    <Form.Item label={label} htmlFor={id} className="flex-1">
      <TimePicker
        id={id}
        className="w-full"
        format="HH:mm"
        minuteStep={5}
        needConfirm={false}
        value={value ? dayjs(value, "HH:mm") : null}
        onChange={(t) => onChange(t ? t.format("HH:mm") : null)}
      />
    </Form.Item>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={TITLES[mode]}
      width={420}
      destroyOnHidden
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="primary"
            disabled={!ready}
            loading={saving}
            onClick={onSubmit}
          >
            {mode === "record" ? "Save fix" : "Send request"}
          </Button>
        </div>
      }
    >
      <Form layout="vertical">
        {mode === "record" ? (
          <>
            <Alert
              className="mb-4"
              type="info"
              showIcon
              message="Replaces that day's punches with these times, approved straight away. The employee is emailed."
            />
            <Form.Item label="Employee" htmlFor="att-employee">
              <Select
                id="att-employee"
                showSearch
                optionFilterProp="label"
                placeholder="Choose whose attendance to fix"
                value={employeeId ?? undefined}
                onChange={setEmployeeId}
                options={people.map((p) => ({
                  value: p.id,
                  label: p.jobTitle ? `${p.name} · ${p.jobTitle}` : p.name,
                }))}
              />
            </Form.Item>
          </>
        ) : null}

        {isFix ? (
          <>
            <Form.Item
              label="Date"
              htmlFor="att-date"
              help="Up to 30 days back."
            >
              <DatePicker
                id="att-date"
                className="w-full"
                format={DATE_FORMATS}
                disabledDate={outOfRange}
                value={date ? dayjs(date) : null}
                onChange={(d) => setDate(pick(d))}
              />
            </Form.Item>
            <div className="flex gap-3">
              {timeField("Clock in", "att-in", clockIn, setClockIn)}
              {timeField("Clock out", "att-out", clockOut, setClockOut)}
            </div>
            {clockIn && clockOut && clockOut <= clockIn ? (
              <Alert
                className="mb-4"
                type="warning"
                showIcon
                message="Clock-out must be after clock-in."
              />
            ) : null}
          </>
        ) : (
          <div className="flex gap-3">
            <Form.Item label="From" htmlFor="att-from" className="flex-1">
              <DatePicker
                id="att-from"
                className="w-full"
                format={DATE_FORMATS}
                disabledDate={outOfRange}
                value={date ? dayjs(date) : null}
                onChange={(d) => {
                  const v = pick(d);
                  setDate(v);
                  if (v && (!endDate || endDate < v)) setEndDate(v);
                }}
              />
            </Form.Item>
            <Form.Item label="To" htmlFor="att-to" className="flex-1">
              <DatePicker
                id="att-to"
                className="w-full"
                format={DATE_FORMATS}
                disabledDate={(d) =>
                  outOfRange(d) ||
                  (Boolean(date) && d.isBefore(dayjs(date), "day"))
                }
                value={endDate ? dayjs(endDate) : null}
                onChange={(d) => setEndDate(pick(d))}
              />
            </Form.Item>
          </div>
        )}

        <Form.Item
          label="Reason (optional)"
          htmlFor="att-reason"
        >
          <Input.TextArea
            id="att-reason"
            rows={3}
            maxLength={500}
            showCount
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              mode === "wfh"
                ? "e.g. Plumber visit in the morning"
                : "e.g. Forgot to clock out"
            }
          />
        </Form.Item>
        {error ? <Alert type="error" showIcon message={error} /> : null}
      </Form>
    </Drawer>
  );
}
