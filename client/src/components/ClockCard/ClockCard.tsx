import {
  ClockCircleOutlined,
  LoginOutlined,
  LogoutOutlined,
} from "@ant-design/icons";
import { Alert, Button, Card, message, Skeleton, Tag, theme } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ROUTES } from "../../constants/routes";
import { useAppDispatch, useAppSelector } from "../../hooks/store";
import { selectAttendance } from "../../store/attendance/attendanceSelectors";
import {
  clockIn,
  clockOut,
  fetchToday,
  refreshMyAttendance,
} from "../../store/attendance/attendanceThunks";
import {
  formatMinutes,
  formatTime,
  STATUS_META,
} from "../../utils/attendanceFormat";

/** Re-renders every `ms` so the clock and the worked-so-far timer tick. */
function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** Home's attendance card: a live clock, today's status and the Clock In / Clock Out button. */
export function ClockCard() {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const { today, todayLoadedAt, todayStatus, todayError, clocking } =
    useAppSelector(selectAttendance);
  const now = useTick(1000);

  useEffect(() => {
    void dispatch(fetchToday());
  }, [dispatch]);

  const onClock = async () => {
    const result = today?.clockedIn
      ? await dispatch(clockOut())
      : await dispatch(clockIn());
    if (clockIn.rejected.match(result) || clockOut.rejected.match(result)) {
      void message.error(result.payload ?? "Something went wrong");
      // The server knows better (e.g. clocked in from another tab): show its view.
      void dispatch(fetchToday());
      return;
    }
    void message.success(
      today?.clockedIn
        ? "Clocked out. See you tomorrow!"
        : "Clocked in. Have a good day!",
    );
    void dispatch(refreshMyAttendance());
  };

  let body;
  if (todayError && !today) {
    body = <Alert type="error" showIcon message={todayError} />;
  } else if (!today || todayStatus === "loading") {
    body = <Skeleton active paragraph={{ rows: 2 }} />;
  } else {
    // While clocked in, keep counting on from the server's figure.
    const extra =
      today.clockedIn && todayLoadedAt
        ? Math.max(0, Math.floor((now - todayLoadedAt) / 60_000))
        : 0;
    const worked = today.day.workedMinutes + extra;
    const meta = STATUS_META[today.day.status];
    body = (
      <>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div
              className="text-3xl font-semibold tabular-nums"
              style={{ color: token.colorPrimary }}
              data-testid="clock-time"
            >
              {dayjs(now).format("HH:mm:ss")}
            </div>
            <div
              className="text-sm"
              style={{ color: token.colorTextSecondary }}
            >
              Shift {today.schedule.shiftStart}–{today.schedule.shiftEnd}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Tag color={meta.color} className="!mr-0">
              {meta.label}
            </Tag>
            {today.day.late ? (
              <Tag color="orange" className="!mr-0">
                Late
              </Tag>
            ) : null}
            {today.day.wfh ? (
              <Tag color="blue" className="!mr-0">
                WFH
              </Tag>
            ) : null}
          </div>
        </div>
        <div className="my-3 text-sm" data-testid="clock-summary">
          {today.clockedIn ? (
            <>
              In since <strong>{formatTime(today.clockedInSince)}</strong> ·{" "}
              {formatMinutes(worked)} today
            </>
          ) : today.punches.length ? (
            <>
              {formatMinutes(worked)} today · last out{" "}
              {formatTime(today.day.lastOut)}
            </>
          ) : today.day.holidayName ? (
            <>Today is {today.day.holidayName} 🎉</>
          ) : (
            "You haven’t clocked in today."
          )}
        </div>
        <Button
          block
          size="large"
          type={today.clockedIn ? "default" : "primary"}
          danger={today.clockedIn}
          icon={today.clockedIn ? <LogoutOutlined /> : <LoginOutlined />}
          loading={clocking}
          disabled={!today.clockedIn && !today.canClockIn}
          onClick={onClock}
        >
          {today.clockedIn ? "Clock out" : "Clock in"}
        </Button>
        {!today.clockedIn && !today.canClockIn && today.cannotClockInReason ? (
          <div
            className="mt-2 text-center text-xs"
            style={{ color: token.colorTextSecondary }}
          >
            {today.cannotClockInReason}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <Card
      className="mb-4"
      title={
        <span className="flex items-center gap-2">
          <ClockCircleOutlined style={{ color: token.colorPrimary }} />{" "}
          Attendance
        </span>
      }
      extra={<Link to={`${ROUTES.me}/attendance`}>My attendance</Link>}
    >
      {body}
    </Card>
  );
}
