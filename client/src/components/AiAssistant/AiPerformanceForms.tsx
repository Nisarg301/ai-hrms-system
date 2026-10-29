import { DatePicker, Form, Input, InputNumber, Select, Slider, Switch } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { AiCheckInFormValues, AiGoalFormValues, AiReviewFormValues } from '../../types/ai';
import { GOAL_STATUS_OPTIONS } from '../../utils/performanceFormat';
import { RatingPicker } from '../Reviews/RatingPicker';

// The Performance tab's own forms on a confirm card: the New goal dialog, the goal drawer's
// Check in, and the review drawer (docs/AI_ME_ASSISTANTS.md, section 6).
const FORMATS = ['DD MMM YYYY', 'YYYY-MM-DD'];
const iso = (d: Dayjs) => d.format('YYYY-MM-DD');

const itemFor = (prefix: string, errors: Record<string, string>) => (key: string, label: string, help?: string) => ({
  label,
  htmlFor: `${prefix}-${key}`,
  validateStatus: errors[key] ? ('error' as const) : undefined,
  help: errors[key] ?? help,
  className: '!mb-2',
});

/** The New goal dialog's rules. */
export function validateGoalValues(values: AiGoalFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.title.trim()) errors.title = 'Give the goal a title';
  else if (values.title.length > 120) errors.title = 'Keep the title under 120 characters';
  if (values.description.length > 2000) errors.description = 'Keep the description under 2,000 characters';
  if (!values.startDate) errors.startDate = 'Choose a start date';
  if (!values.dueDate) errors.dueDate = 'Choose a due date';
  else if (values.startDate && values.dueDate < values.startDate) errors.dueDate = 'The due date can’t be before the start date';
  if (values.weight !== null && (!Number.isInteger(values.weight) || values.weight < 1 || values.weight > 100)) errors.weight = 'A whole number from 1 to 100';
  return errors;
}

/** The goal drawer's Check in rules. */
export function validateCheckInValues(values: AiCheckInFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!Number.isInteger(values.progress) || values.progress < 0 || values.progress > 100) errors.progress = 'From 0 to 100%';
  if (values.comment.length > 1000) errors.comment = 'Keep the comment under 1,000 characters';
  return errors;
}

/** The review drawer's rules: a draft can be partial; submitting needs every answer and a rating. */
export function validateReviewValues(values: AiReviewFormValues, questions: { id: string }[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const q of questions) {
    const answer = values.answers[q.id] ?? '';
    if (answer.length > 5000) errors[q.id] = 'Keep each answer under 5,000 characters';
    else if (values.submitNow && !answer.trim()) errors[q.id] = 'Answer this question to submit';
  }
  if (values.submitNow && !values.rating) errors.rating = 'Choose a rating from 1 to 5';
  return errors;
}

interface AiGoalFormProps {
  mode: 'create' | 'update';
  values: AiGoalFormValues;
  owners: { id: string; name: string }[];
  errors: Record<string, string>;
  onChange: (values: AiGoalFormValues) => void;
}

/** The confirm card's goal, as in the New goal dialog: who it's for (a new one), title, description, dates and weight. */
export function AiGoalForm({ mode, values, owners, errors, onChange }: AiGoalFormProps) {
  const set = <K extends keyof AiGoalFormValues>(key: K, value: AiGoalFormValues[K]) => onChange({ ...values, [key]: value });
  const item = itemFor('ai-goal', errors);
  return (
    <Form layout="vertical" size="small" component="div">
      {mode === 'create' && owners.length ? (
        <Form.Item {...item('ownerId', 'For')}>
          <Select
            id="ai-goal-ownerId"
            showSearch
            optionFilterProp="label"
            value={values.ownerId}
            onChange={(v) => set('ownerId', v)}
            options={[{ value: '', label: 'Me' }, ...owners.map((o) => ({ value: o.id, label: o.name }))]}
          />
        </Form.Item>
      ) : null}
      <Form.Item {...item('title', 'Goal')}>
        <Input id="ai-goal-title" maxLength={120} value={values.title} onChange={(e) => set('title', e.target.value)} />
      </Form.Item>
      <Form.Item {...item('description', 'Description (optional)')}>
        <Input.TextArea id="ai-goal-description" autoSize={{ minRows: 1, maxRows: 4 }} maxLength={2000} value={values.description} onChange={(e) => set('description', e.target.value)} />
      </Form.Item>
      <div className="flex gap-2">
        <Form.Item {...item('startDate', 'Start')} className="!mb-2 flex-1">
          <DatePicker id="ai-goal-startDate" className="w-full" format={FORMATS} allowClear={false} value={values.startDate ? dayjs(values.startDate) : null} onChange={(d) => set('startDate', d ? iso(d) : '')} />
        </Form.Item>
        <Form.Item {...item('dueDate', 'Due')} className="!mb-2 flex-1">
          <DatePicker id="ai-goal-dueDate" className="w-full" format={FORMATS} value={values.dueDate ? dayjs(values.dueDate) : null} onChange={(d) => set('dueDate', d ? iso(d) : '')} />
        </Form.Item>
      </div>
      <Form.Item {...item('weight', 'Weight (optional)')}>
        <InputNumber id="ai-goal-weight" className="w-full" min={1} max={100} precision={0} suffix="%" value={values.weight} onChange={(v) => set('weight', v ?? null)} />
      </Form.Item>
    </Form>
  );
}

/** The confirm card's check-in, as in the goal drawer: progress, status and a comment. */
export function AiCheckInForm({ values, errors, onChange }: { values: AiCheckInFormValues; errors: Record<string, string>; onChange: (values: AiCheckInFormValues) => void }) {
  const set = <K extends keyof AiCheckInFormValues>(key: K, value: AiCheckInFormValues[K]) => onChange({ ...values, [key]: value });
  const item = itemFor('ai-checkin', errors);
  return (
    <Form layout="vertical" size="small" component="div">
      <Form.Item {...item('progress', 'Progress')}>
        <div className="flex items-center gap-3">
          <Slider className="flex-1" min={0} max={100} step={5} value={values.progress} onChange={(v) => set('progress', v)} tooltip={{ formatter: (v) => `${v}%` }} />
          <InputNumber id="ai-checkin-progress" min={0} max={100} precision={0} suffix="%" value={values.progress} onChange={(v) => set('progress', v ?? 0)} />
        </div>
      </Form.Item>
      <Form.Item {...item('status', 'Status')}>
        <Select id="ai-checkin-status" value={values.status} onChange={(v) => set('status', v)} options={GOAL_STATUS_OPTIONS} />
      </Form.Item>
      <Form.Item {...item('comment', 'Comment (optional)')}>
        <Input.TextArea id="ai-checkin-comment" autoSize={{ minRows: 1, maxRows: 4 }} maxLength={1000} value={values.comment} onChange={(e) => set('comment', e.target.value)} />
      </Form.Item>
    </Form>
  );
}

interface AiReviewFormProps {
  values: AiReviewFormValues;
  questions: { id: string; text: string }[];
  errors: Record<string, string>;
  onChange: (values: AiReviewFormValues) => void;
}

/** The confirm card's review, as in the review drawer: each question's answer, the rating, and Submit now. */
export function AiReviewForm({ values, questions, errors, onChange }: AiReviewFormProps) {
  const item = itemFor('ai-review', errors);
  return (
    <Form layout="vertical" size="small" component="div">
      {questions.map((q) => (
        <Form.Item key={q.id} {...item(q.id, q.text)}>
          <Input.TextArea
            id={`ai-review-${q.id}`}
            autoSize={{ minRows: 2, maxRows: 6 }}
            maxLength={5000}
            value={values.answers[q.id] ?? ''}
            onChange={(e) => onChange({ ...values, answers: { ...values.answers, [q.id]: e.target.value } })}
          />
        </Form.Item>
      ))}
      <Form.Item {...item('rating', 'Overall rating')}>
        <RatingPicker id="ai-review-rating" value={values.rating} onChange={(rating) => onChange({ ...values, rating })} />
      </Form.Item>
      <Form.Item {...item('submitNow', 'Submit now', values.submitNow ? 'It can’t be changed afterwards unless an admin reopens it.' : 'Saved as a draft, to finish later.')}>
        <Switch id="ai-review-submitNow" size="small" checked={values.submitNow} onChange={(submitNow) => onChange({ ...values, submitNow })} />
      </Form.Item>
    </Form>
  );
}
