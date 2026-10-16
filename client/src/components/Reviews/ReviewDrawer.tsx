import { Alert, Button, Card, Drawer, Empty, Input, message, Modal, Progress, Space, Tag, theme, Typography } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectPerformance } from '../../store/performance/performanceSelectors';
import { writeReviewPart } from '../../store/performance/performanceThunks';
import type { ReviewDetail, ReviewPartName, ReviewPartView } from '../../types/performance';
import { GOAL_STATUS_META, PART_STATUS_META, RATING_LABELS } from '../../utils/performanceFormat';
import { RatingPicker } from './RatingPicker';

/** A submitted (or visible) part: each question with its answer, and the rating. */
function PartReadOnly({ part, testId }: { part: ReviewPartView; testId: string }) {
  const { token } = theme.useToken();
  return (
    <div data-testid={testId}>
      {part.status !== 'submitted' ? <Tag className="mb-2">Draft</Tag> : null}
      <dl className="m-0">
        {part.answers.map((a) => (
          <div key={a.questionId} className="mb-3">
            <dt className="font-medium">{a.question}</dt>
            <dd className="m-0" style={{ whiteSpace: 'pre-wrap', color: a.text ? undefined : token.colorTextTertiary }}>
              {a.text || 'No answer'}
            </dd>
          </div>
        ))}
      </dl>
      <div>
        <span style={{ color: token.colorTextSecondary }}>Rating: </span>
        <strong>{part.rating ? `${part.rating} · ${RATING_LABELS[part.rating]}` : '—'}</strong>
      </div>
      {part.submittedAt ? (
        <div className="mt-1 text-xs" style={{ color: token.colorTextSecondary }}>
          Submitted {dayjs(part.submittedAt).format('D MMM YYYY')}
        </div>
      ) : null}
    </div>
  );
}

type Draft = { answers: Record<string, string>; rating: number | null };

function draftOf(part: ReviewPartView | null): Draft {
  return { answers: Object.fromEntries((part?.answers ?? []).map((a) => [a.questionId, a.text])), rating: part?.rating ?? null };
}

/** The questions as text boxes, and the rating. */
function PartForm({ review, part, draft, onChange }: { review: ReviewDetail; part: ReviewPartName; draft: Draft; onChange: (d: Draft) => void }) {
  return (
    <div className="flex flex-col gap-3">
      {review.cycle.questions.map((q, i) => (
        <div key={q.id}>
          <label htmlFor={`rv-${part}-${i}`} className="mb-1 block font-medium">
            {q.text}
          </label>
          <Input.TextArea
            id={`rv-${part}-${i}`}
            rows={3}
            maxLength={5000}
            value={draft.answers[q.id] ?? ''}
            onChange={(e) => onChange({ ...draft, answers: { ...draft.answers, [q.id]: e.target.value } })}
          />
        </div>
      ))}
      <div>
        <div className="mb-1 font-medium">Overall rating</div>
        <RatingPicker id={`rv-${part}-rating`} value={draft.rating} onChange={(rating) => onChange({ ...draft, rating })} />
      </div>
    </div>
  );
}

/**
 * A review: my self review (and, once released, my manager's); or, as the reviewer, the
 * employee's submitted self review next to the manager review I write.
 */
export function ReviewDrawer({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const { currentReview: review } = useAppSelector(selectPerformance);
  const writable: ReviewPartName | null = review?.canWriteSelf ? 'self' : review?.canWriteManager ? 'manager' : null;
  const [draft, setDraft] = useState<Draft>({ answers: {}, rating: null });
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reviewId = review?.id;
  useEffect(() => {
    if (!review) return;
    setDraft(draftOf(writable ? review[writable] : null));
    setError(null);
    // Only when another review opens: saving returns the same answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewId, writable]);

  if (!review) return <Drawer open={false} />;
  const isMine = review.role === 'employee';
  const name = review.employee?.name ?? 'Former member';
  const firstName = name.split(/\s+/)[0];

  const answers = () => review.cycle.questions.map((q) => ({ questionId: q.id, text: (draft.answers[q.id] ?? '').trim() }));
  /** What's missing before it can be submitted, or null. */
  const missing = (): string | null => {
    const unanswered = answers().filter((a) => !a.text).length;
    const problems = [unanswered ? `Answer every question (${unanswered} left)` : null, !draft.rating ? 'Choose a rating from 1 to 5' : null].filter(Boolean);
    return problems.length ? problems.join('. ') : null;
  };

  const save = async (submit: boolean) => {
    if (!writable) return;
    setSaving(submit ? 'submit' : 'draft');
    setError(null);
    const result = await dispatch(writeReviewPart({ id: review.id, part: writable, payload: { answers: answers(), rating: draft.rating }, submit }));
    setSaving(null);
    if (writeReviewPart.rejected.match(result)) {
      const fieldErrors = (result.payload?.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors;
      setError(fieldErrors ? Object.values(fieldErrors).map((v) => v[0]).join('. ') : (result.payload?.message ?? 'Could not save'));
      return;
    }
    void message.success(submit ? 'Submitted' : 'Draft saved');
    onChanged();
  };

  /** Checks it's complete first; only then asks to confirm. */
  const confirmSubmit = () => {
    const problem = missing();
    setError(problem);
    if (problem) return;
    Modal.confirm({
      title: writable === 'self' ? 'Submit your self review?' : `Submit your review of ${firstName}?`,
      content: 'You can’t change it afterwards unless an admin reopens it.',
      okText: 'Submit',
      cancelText: 'Keep editing',
      onOk: () => save(true),
    });
  };

  const due = writable === 'self' ? review.cycle.selfDueDate : review.cycle.managerDueDate;
  const selfSection = isMine ? (
    writable === 'self' ? (
      <PartForm review={review} part="self" draft={draft} onChange={setDraft} />
    ) : review.self ? (
      <PartReadOnly part={review.self} testId="self-part" />
    ) : null
  ) : review.self ? (
    <PartReadOnly part={review.self} testId="self-part" />
  ) : (
    <Alert type="info" showIcon message={`${firstName} hasn’t submitted a self review yet (${PART_STATUS_META[review.selfStatus].label.toLowerCase()}).`} />
  );
  const managerSection =
    writable === 'manager' ? (
      <PartForm review={review} part="manager" draft={draft} onChange={setDraft} />
    ) : review.manager?.status === 'not_started' ? (
      <Alert type="info" showIcon message="Not started yet." />
    ) : review.manager ? (
      <PartReadOnly part={review.manager} testId="manager-part" />
    ) : (
      <Alert type="info" showIcon message="Your manager’s review will show here once your admin releases the results." />
    );

  return (
    <Drawer
      open
      width={760}
      onClose={onClose}
      destroyOnHidden
      title={
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span>{isMine ? `Your ${review.cycle.name} review` : `${name}'s ${review.cycle.name} review`}</span>
            {review.released ? <Tag color="green">Released</Tag> : null}
            {review.cycle.status === 'closed' ? <Tag>Closed</Tag> : null}
          </div>
          <div className="text-xs font-normal" style={{ color: token.colorTextSecondary }}>
            {dayjs(review.cycle.periodFrom).format('D MMM YYYY')} – {dayjs(review.cycle.periodTo).format('D MMM YYYY')}
            {writable ? ` · due ${dayjs(due).format('D MMM YYYY')}` : ''}
          </div>
        </div>
      }
      footer={
        writable ? (
          <div className="flex justify-end gap-2">
            <Button loading={saving === 'draft'} disabled={saving === 'submit'} onClick={() => save(false)}>
              Save draft
            </Button>
            <Button type="primary" loading={saving === 'submit'} disabled={saving === 'draft'} onClick={confirmSubmit}>
              Submit
            </Button>
          </div>
        ) : null
      }
    >
      {error ? <Alert className="mb-3" type="error" showIcon message={error} /> : null}

      <Card size="small" className="mb-4" title={`Goals this period${review.goalsAsOf ? ` (as of ${dayjs(review.goalsAsOf).format('D MMM')})` : ''}`} data-testid="review-goals">
        {review.goals.length ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {review.goals.map((g) => (
              <li key={g.goalId} className="grid grid-cols-[1fr_120px_auto] items-center gap-3">
                <span className="truncate">
                  {g.title}
                  {g.weight !== null ? <span style={{ color: token.colorTextSecondary }}> · {g.weight}%</span> : null}
                </span>
                <Progress percent={g.progress} size="small" />
                <Tag color={GOAL_STATUS_META[g.status].color} className="!mr-0">
                  {GOAL_STATUS_META[g.status].label}
                </Tag>
              </li>
            ))}
          </ul>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No goals in this period" />
        )}
      </Card>

      <Space direction="vertical" size="large" className="w-full">
        <section>
          <Typography.Title level={5}>{isMine ? 'Your self review' : `${firstName}’s self review`}</Typography.Title>
          {selfSection}
        </section>
        <section>
          <Typography.Title level={5}>{isMine ? 'Your manager’s review' : 'Manager review'}</Typography.Title>
          {!isMine && !writable && review.reviewer ? (
            <div className="mb-2 text-sm" style={{ color: token.colorTextSecondary }}>
              Written by {review.reviewer.name}
            </div>
          ) : null}
          {managerSection}
        </section>
      </Space>
    </Drawer>
  );
}
