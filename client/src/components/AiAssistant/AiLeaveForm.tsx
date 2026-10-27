import { DatePicker, Form, Input, Radio, Segmented, Select } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { AiLeaveFormValues, AiLeaveTypeOption } from '../../types/ai';

const FORMATS = ['DD MMM YYYY', 'YYYY-MM-DD'];
const iso = (d: Dayjs) => d.format('YYYY-MM-DD');

/** The Apply leave drawer's rules: a type, the dates (from today on, one calendar year), a reason of at most 500 characters. */
export function validateLeaveValues(values: AiLeaveFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.leaveTypeId) errors.leaveTypeId = 'Choose a leave type';
  if (!values.startDate || (!values.halfDay && !values.endDate)) errors.startDate = 'Choose the dates';
  else if (!values.halfDay && values.endDate < values.startDate) errors.startDate = 'The end date is before the start date';
  else if (values.startDate.slice(0, 4) !== (values.halfDay ? values.startDate : values.endDate).slice(0, 4)) errors.startDate = 'Keep it within one calendar year';
  if (values.reason.length > 500) errors.reason = 'At most 500 characters';
  return errors;
}

interface AiLeaveFormProps {
  values: AiLeaveFormValues;
  types: AiLeaveTypeOption[];
  errors: Record<string, string>;
  onChange: (values: AiLeaveFormValues) => void;
}

/** The confirm card's leave request, as on the Apply leave drawer. */
export function AiLeaveForm({ values, types, errors, onChange }: AiLeaveFormProps) {
  const set = (patch: Partial<AiLeaveFormValues>) => onChange({ ...values, ...patch });
  const type = types.find((t) => t.id === values.leaveTypeId);
  const half = values.halfDay !== null && Boolean(type?.allowHalfDay);
  const beforeToday = (d: Dayjs) => d.isBefore(dayjs(), 'day');
  const item = (key: keyof AiLeaveFormValues, label: string) => ({
    label,
    htmlFor: `ai-leave-${key}`,
    validateStatus: errors[key] ? ('error' as const) : undefined,
    help: errors[key],
    className: '!mb-2',
  });

  return (
    <Form layout="vertical" size="small" component="div">
      <Form.Item {...item('leaveTypeId', 'Leave type')}>
        <Select
          id="ai-leave-leaveTypeId"
          value={values.leaveTypeId || undefined}
          // A type without half days can't keep one.
          onChange={(id) => set({ leaveTypeId: id, halfDay: types.find((t) => t.id === id)?.allowHalfDay ? values.halfDay : null })}
          options={types.map((t) => ({ value: t.id, label: `${t.name} · ${t.available === null ? 'unlimited' : `${t.available} left`}` }))}
        />
      </Form.Item>
      {type?.allowHalfDay ? (
        <Form.Item className="!mb-2">
          <Segmented
            block
            size="small"
            value={half ? 'half' : 'full'}
            onChange={(v) => set(v === 'half' ? { halfDay: 'first', endDate: values.startDate } : { halfDay: null })}
            options={[
              { label: 'Full day(s)', value: 'full' },
              { label: 'Half day', value: 'half' },
            ]}
          />
        </Form.Item>
      ) : null}
      {half ? (
        <>
          <Form.Item {...item('startDate', 'Date')}>
            <DatePicker
              id="ai-leave-startDate"
              className="w-full"
              format={FORMATS}
              disabledDate={beforeToday}
              value={values.startDate ? dayjs(values.startDate) : null}
              onChange={(d) => set({ startDate: d ? iso(d) : '', endDate: d ? iso(d) : '' })}
            />
          </Form.Item>
          <Form.Item className="!mb-2">
            <Radio.Group value={values.halfDay} onChange={(e) => set({ halfDay: e.target.value })}>
              <Radio value="first">First half</Radio>
              <Radio value="second">Second half</Radio>
            </Radio.Group>
          </Form.Item>
        </>
      ) : (
        <Form.Item {...item('startDate', 'Dates')}>
          <DatePicker.RangePicker
            id="ai-leave-startDate"
            className="w-full"
            format={FORMATS}
            disabledDate={beforeToday}
            value={values.startDate && values.endDate ? [dayjs(values.startDate), dayjs(values.endDate)] : null}
            onChange={(range) => set({ startDate: range?.[0] ? iso(range[0]) : '', endDate: range?.[1] ? iso(range[1]) : '' })}
          />
        </Form.Item>
      )}
      <Form.Item {...item('reason', 'Reason (optional)')}>
        <Input.TextArea id="ai-leave-reason" autoSize={{ minRows: 2, maxRows: 4 }} maxLength={500} value={values.reason} onChange={(e) => set({ reason: e.target.value })} />
      </Form.Item>
    </Form>
  );
}
