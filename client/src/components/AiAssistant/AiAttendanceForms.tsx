import { DatePicker, Form, Input, TimePicker } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { AiFixFormValues, AiWfhFormValues } from '../../types/ai';

// The Attendance tab's request drawer: work from home up to 7 days back, fixes up to 30 days back.
const WFH_BACK_DAYS = 7;
const FIX_BACK_DAYS = 30;
const FORMATS = ['DD MMM YYYY', 'YYYY-MM-DD'];
const iso = (d: Dayjs) => d.format('YYYY-MM-DD');

export function validateWfhValues(values: AiWfhFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.startDate || !values.endDate) errors.startDate = 'Choose the dates';
  else if (values.endDate < values.startDate) errors.startDate = 'The end date is before the start date';
  else if (values.startDate.slice(0, 4) !== values.endDate.slice(0, 4)) errors.startDate = 'Keep it within one calendar year';
  if (values.reason.length > 500) errors.reason = 'At most 500 characters';
  return errors;
}

export function validateFixValues(values: AiFixFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.date) errors.date = 'Choose the date';
  if (!values.clockIn) errors.clockIn = 'Choose the clock-in time';
  if (!values.clockOut) errors.clockOut = 'Choose the clock-out time';
  else if (values.clockIn && values.clockOut <= values.clockIn) errors.clockOut = 'Clock-out must be after clock-in';
  if (values.reason.length > 500) errors.reason = 'At most 500 characters';
  return errors;
}

const itemFor = (prefix: string, errors: Record<string, string>) => (key: string, label: string) => ({
  label,
  htmlFor: `${prefix}-${key}`,
  validateStatus: errors[key] ? ('error' as const) : undefined,
  help: errors[key],
  className: '!mb-2',
});

/** The confirm card's work-from-home request, as on the Request WFH drawer. */
export function AiWfhForm({ values, errors, onChange }: { values: AiWfhFormValues; errors: Record<string, string>; onChange: (values: AiWfhFormValues) => void }) {
  const item = itemFor('ai-wfh', errors);
  const earliest = dayjs().subtract(WFH_BACK_DAYS, 'day');
  return (
    <Form layout="vertical" size="small" component="div">
      <Form.Item {...item('startDate', 'Dates')}>
        <DatePicker.RangePicker
          id="ai-wfh-startDate"
          className="w-full"
          format={FORMATS}
          disabledDate={(d) => d.isBefore(earliest, 'day')}
          value={values.startDate && values.endDate ? [dayjs(values.startDate), dayjs(values.endDate)] : null}
          onChange={(range) => onChange({ ...values, startDate: range?.[0] ? iso(range[0]) : '', endDate: range?.[1] ? iso(range[1]) : '' })}
        />
      </Form.Item>
      <Form.Item {...item('reason', 'Reason (optional)')}>
        <Input.TextArea id="ai-wfh-reason" autoSize={{ minRows: 2, maxRows: 4 }} maxLength={500} value={values.reason} onChange={(e) => onChange({ ...values, reason: e.target.value })} />
      </Form.Item>
    </Form>
  );
}

/** The confirm card's attendance fix, as on the Request a fix drawer. */
export function AiFixForm({ values, errors, onChange }: { values: AiFixFormValues; errors: Record<string, string>; onChange: (values: AiFixFormValues) => void }) {
  const item = itemFor('ai-fix', errors);
  const earliest = dayjs().subtract(FIX_BACK_DAYS, 'day');
  const time = (key: 'clockIn' | 'clockOut', label: string) => (
    <Form.Item {...item(key, label)} className="!mb-2 flex-1">
      <TimePicker
        id={`ai-fix-${key}`}
        className="w-full"
        format="HH:mm"
        minuteStep={5}
        needConfirm={false}
        value={values[key] ? dayjs(`2000-01-01T${values[key]}`) : null}
        onChange={(t) => onChange({ ...values, [key]: t ? t.format('HH:mm') : '' })}
      />
    </Form.Item>
  );
  return (
    <Form layout="vertical" size="small" component="div">
      <Form.Item {...item('date', 'Date')}>
        <DatePicker
          id="ai-fix-date"
          className="w-full"
          format={FORMATS}
          disabledDate={(d) => d.isAfter(dayjs(), 'day') || d.isBefore(earliest, 'day')}
          value={values.date ? dayjs(values.date) : null}
          onChange={(d) => onChange({ ...values, date: d ? iso(d) : '' })}
        />
      </Form.Item>
      <div className="flex gap-2">
        {time('clockIn', 'Clock in')}
        {time('clockOut', 'Clock out')}
      </div>
      <Form.Item {...item('reason', 'Reason (optional)')}>
        <Input.TextArea id="ai-fix-reason" autoSize={{ minRows: 2, maxRows: 4 }} maxLength={500} value={values.reason} onChange={(e) => onChange({ ...values, reason: e.target.value })} />
      </Form.Item>
    </Form>
  );
}
