import { zodResolver } from '@hookform/resolvers/zod';
import { SaveOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, InputNumber, message, Skeleton, TimePicker, Typography } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectAttendanceAdmin } from '../../store/attendanceAdmin/attendanceAdminSelectors';
import { fetchSchedule, saveSchedule } from '../../store/attendanceAdmin/attendanceAdminThunks';
import { ApiError } from '../../types/api';
import { applyServerFieldErrors } from '../../utils/applyServerFieldErrors';
import { scheduleFormSchema, type ScheduleFormValues } from '../../validation/schedule.schema';

export default function AttendanceSettingsPage() {
  const dispatch = useAppDispatch();
  const { schedule } = useAppSelector(selectAttendanceAdmin);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { control, handleSubmit, reset, setError, formState } = useForm<ScheduleFormValues>({ resolver: zodResolver(scheduleFormSchema) });

  useEffect(() => {
    void dispatch(fetchSchedule());
  }, [dispatch]);
  useEffect(() => {
    if (schedule) {
      reset({
        shiftStart: schedule.shiftStart,
        shiftEnd: schedule.shiftEnd,
        graceMinutes: schedule.graceMinutes,
        fullDayHours: schedule.fullDayMinutes / 60,
        halfDayHours: schedule.halfDayMinutes / 60,
      });
    }
  }, [schedule, reset]);

  const onSubmit = handleSubmit(async (v) => {
    setServerError(null);
    setSaving(true);
    const result = await dispatch(
      saveSchedule({
        shiftStart: v.shiftStart,
        shiftEnd: v.shiftEnd,
        graceMinutes: v.graceMinutes,
        fullDayMinutes: Math.round(v.fullDayHours * 60),
        halfDayMinutes: Math.round(v.halfDayHours * 60),
      })
    );
    setSaving(false);
    if (saveSchedule.rejected.match(result)) {
      const p = result.payload;
      const error = p ? new ApiError(p.status, p.message, p.details) : new ApiError(0, 'Could not save the schedule');
      const setFieldError = setError as (field: string, e: { type: string; message: string }) => void;
      if (!applyServerFieldErrors(error, setFieldError, ['shiftStart', 'shiftEnd', 'graceMinutes'])) setServerError(error.message);
      return;
    }
    void message.success('Schedule saved. It applies to every day from now on, and to past days too.');
  });

  const errors = formState.errors;
  const time = (name: 'shiftStart' | 'shiftEnd', label: string) => (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <Form.Item label={label} htmlFor={name} validateStatus={errors[name] ? 'error' : ''} help={errors[name]?.message} className="flex-1">
          <TimePicker
            id={name}
            className="w-full"
            format="HH:mm"
            minuteStep={5}
            needConfirm={false}
            allowClear={false}
            value={field.value ? dayjs(field.value, 'HH:mm') : null}
            onChange={(t) => field.onChange(t ? t.format('HH:mm') : '')}
          />
        </Form.Item>
      )}
    />
  );
  const number = (name: 'graceMinutes' | 'fullDayHours' | 'halfDayHours', label: string, help: string, step: number) => (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <Form.Item label={label} htmlFor={name} validateStatus={errors[name] ? 'error' : ''} help={errors[name]?.message ?? help}>
          <InputNumber id={name} className="w-full" min={0} step={step} value={field.value} onChange={(v) => field.onChange(v ?? undefined)} />
        </Form.Item>
      )}
    />
  );

  return (
    <div className="max-w-2xl">
      <Typography.Title level={4}>Attendance settings</Typography.Title>
      <Card>
        {!schedule ? (
          <Skeleton active />
        ) : (
          <Form layout="vertical">
            {serverError ? <Alert className="mb-4" type="error" showIcon message={serverError} /> : null}
            <Typography.Paragraph type="secondary">
              One schedule for the whole organization. Monday to Friday are working days; weekends and holidays aren't.
            </Typography.Paragraph>
            <div className="flex gap-3">
              {time('shiftStart', 'Shift starts')}
              {time('shiftEnd', 'Shift ends')}
            </div>
            {number('graceMinutes', 'Grace period (minutes)', 'Clocking in later than the start plus this is marked late.', 5)}
            <div className="flex gap-3">
              <div className="flex-1">{number('fullDayHours', 'Full day (hours)', 'Hours worked to count as present.', 0.5)}</div>
              <div className="flex-1">{number('halfDayHours', 'Half day (hours)', 'Fewer than this is absent.', 0.5)}</div>
            </div>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={onSubmit}>
              Save schedule
            </Button>
          </Form>
        )}
      </Card>
    </div>
  );
}
