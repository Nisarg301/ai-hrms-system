import { DatePicker, Form, Input } from 'antd';
import dayjs from 'dayjs';
import { INTRODUCTION_QUESTIONS } from '../../pages/home/components/introductionQuestions';
import type { AiBirthdayFormValues, AiIntroductionFormValues } from '../../types/ai';

// The Profile tab's own fields on a confirm card: the date of birth and the introduction
// (docs/AI_ME_ASSISTANTS.md, section 7).
const FORMATS = ['DD MMM YYYY', 'YYYY-MM-DD'];

/** The API's rules for a date of birth: not in the future, from 1900 on. Empty removes it. */
export function validateBirthdayValues(values: AiBirthdayFormValues): Record<string, string> {
  if (!values.dateOfBirth) return {};
  if (values.dateOfBirth > dayjs().format('YYYY-MM-DD')) return { dateOfBirth: "A date of birth can't be in the future" };
  if (values.dateOfBirth < '1900-01-01') return { dateOfBirth: 'Enter a date after 1900' };
  return {};
}

export function validateIntroductionValues(values: AiIntroductionFormValues): Record<string, string> {
  return Object.fromEntries(INTRODUCTION_QUESTIONS.filter((q) => values[q.key].length > 1000).map((q) => [q.key, 'At most 1,000 characters']));
}

/** The confirm card's date of birth. Clearing it removes it, as on the tab. */
export function AiBirthdayForm({ values, errors, onChange }: { values: AiBirthdayFormValues; errors: Record<string, string>; onChange: (values: AiBirthdayFormValues) => void }) {
  return (
    <Form layout="vertical" size="small" component="div">
      <Form.Item
        label="Date of birth"
        htmlFor="ai-birthday-dateOfBirth"
        validateStatus={errors.dateOfBirth ? 'error' : undefined}
        help={errors.dateOfBirth ?? 'Colleagues see only the day and month.'}
        className="!mb-2"
      >
        <DatePicker
          id="ai-birthday-dateOfBirth"
          className="w-full"
          format={FORMATS}
          disabledDate={(d) => d.isAfter(dayjs(), 'day')}
          value={values.dateOfBirth ? dayjs(values.dateOfBirth) : null}
          onChange={(d) => onChange({ dateOfBirth: d ? d.format('YYYY-MM-DD') : '' })}
        />
      </Form.Item>
    </Form>
  );
}

/** The confirm card's introduction: the three Welcome-tab answers. */
export function AiIntroductionForm({ values, errors, onChange }: { values: AiIntroductionFormValues; errors: Record<string, string>; onChange: (values: AiIntroductionFormValues) => void }) {
  return (
    <Form layout="vertical" size="small" component="div">
      {INTRODUCTION_QUESTIONS.map((q) => (
        <Form.Item key={q.key} label={q.title} htmlFor={`ai-intro-${q.key}`} validateStatus={errors[q.key] ? 'error' : undefined} help={errors[q.key]} className="!mb-2">
          <Input.TextArea
            id={`ai-intro-${q.key}`}
            autoSize={{ minRows: 2, maxRows: 5 }}
            maxLength={1000}
            placeholder={q.placeholder}
            value={values[q.key]}
            onChange={(e) => onChange({ ...values, [q.key]: e.target.value })}
          />
        </Form.Item>
      ))}
    </Form>
  );
}
