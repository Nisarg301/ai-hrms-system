import { PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Empty, message, Progress, Row, Segmented, Skeleton, Tabs, Tag, theme } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GoalCard } from '../../../components/Goals/GoalCard';
import { GoalDrawer } from '../../../components/Goals/GoalDrawer';
import { GoalFormModal } from '../../../components/Goals/GoalFormModal';
import { ReviewDrawer } from '../../../components/Reviews/ReviewDrawer';
import { PersonAvatar } from '../../../components/PersonAvatar/PersonAvatar';
import { useAppDispatch, useAppSelector } from '../../../hooks/store';
import { selectAuthUser } from '../../../store/auth/authSelectors';
import { selectPerformance } from '../../../store/performance/performanceSelectors';
import { closeGoal, closeReview } from '../../../store/performance/performanceSlice';
import { fetchMyGoals, fetchMyReviews, fetchReviewsToWrite, fetchTeamGoals, openGoal, openReview } from '../../../store/performance/performanceThunks';
import { selectPeople } from '../../../store/team/teamSelectors';
import { fetchPeople } from '../../../store/team/teamThunks';
import type { Goal } from '../../../types/performance';
import { GOAL_STATUS_META, needsAttention, totalWeight } from '../../../utils/performanceFormat';
import { MyReviews, ReviewsToWrite } from './ReviewLists';

function MyGoals({ onOpen }: { onOpen: (id: string) => void }) {
  const { token } = theme.useToken();
  const { myGoals, myGoalsStatus, myGoalsError } = useAppSelector(selectPerformance);
  const [adding, setAdding] = useState(false);
  const weight = totalWeight(myGoals);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm" style={{ color: token.colorTextSecondary }}>
          {weight !== null ? `Weights add up to ${weight}%${weight !== 100 ? ' (100% is usual)' : ''}.` : 'Track what you’re working towards, and check in as it moves.'}
        </span>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
          New goal
        </Button>
      </div>
      {myGoalsError ? <Alert className="mb-3" type="error" showIcon message={myGoalsError} /> : null}
      {myGoalsStatus !== 'succeeded' && !myGoals.length ? (
        <Skeleton active />
      ) : myGoals.length ? (
        <Row gutter={[16, 16]}>
          {myGoals.map((g) => (
            <Col key={g.id} xs={24} md={12} xl={8}>
              <GoalCard goal={g} onOpen={() => onOpen(g.id)} />
            </Col>
          ))}
        </Row>
      ) : (
        <Empty description="No goals yet. Set one to start tracking progress." />
      )}
      <GoalFormModal open={adding} goal={null} onClose={() => setAdding(false)} />
    </>
  );
}

function TeamGoalRow({ goal, onOpen }: { goal: Goal; onOpen: () => void }) {
  const { token } = theme.useToken();
  const meta = GOAL_STATUS_META[goal.status];
  return (
    <button type="button" onClick={onOpen} className="grid w-full cursor-pointer grid-cols-[1fr_120px_auto] items-center gap-3 rounded-lg border-0 bg-transparent px-2 py-2 text-left hover:bg-black/5" aria-label={`Open ${goal.title}`}>
      <span className="min-w-0">
        <span className="block truncate">{goal.title}</span>
        <span className="text-xs" style={{ color: goal.overdue ? token.colorError : token.colorTextSecondary }}>
          {goal.overdue ? `Overdue · was due ${dayjs(goal.dueDate).format('D MMM')}` : `Due ${dayjs(goal.dueDate).format('D MMM YYYY')}`}
        </span>
      </span>
      <Progress percent={goal.progress} size="small" status={goal.status === 'behind' ? 'exception' : undefined} />
      <Tag color={meta.color} className="!mr-0">
        {meta.label}
      </Tag>
    </button>
  );
}

/** My direct reports' goals: by person, filterable to those needing attention. */
function MyTeam({ onOpen }: { onOpen: (id: string) => void }) {
  const { token } = theme.useToken();
  const me = useAppSelector(selectAuthUser)!;
  const people = useAppSelector(selectPeople);
  const { teamGoals, teamGoalsStatus } = useAppSelector(selectPerformance);
  const [filter, setFilter] = useState<'all' | 'attention'>('all');
  const [adding, setAdding] = useState(false);
  const reports = people.filter((p) => p.reportsTo === me.id);
  const shown = (personId: string) => teamGoals.filter((g) => g.ownerId === personId && (filter === 'all' || needsAttention(g)));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as 'all' | 'attention')}
          options={[
            { label: 'All goals', value: 'all' },
            { label: `Needs attention (${teamGoals.filter(needsAttention).length})`, value: 'attention' },
          ]}
        />
        <Button icon={<PlusOutlined />} onClick={() => setAdding(true)}>
          New goal for…
        </Button>
      </div>
      {teamGoalsStatus !== 'succeeded' && !teamGoals.length ? (
        <Skeleton active />
      ) : (
        <div className="flex flex-col gap-3">
          {reports.map((p) => {
            const goals = shown(p.id);
            if (filter === 'attention' && !goals.length) return null;
            return (
              <Card key={p.id} size="small" data-testid="team-member">
                <div className="mb-1 flex items-center gap-2">
                  <PersonAvatar name={p.name} avatarUrl={p.avatarUrl} size="small" />
                  <span className="font-medium">{p.name}</span>
                  {p.jobTitle ? (
                    <span className="text-xs" style={{ color: token.colorTextSecondary }}>
                      {p.jobTitle}
                    </span>
                  ) : null}
                </div>
                {goals.length ? (
                  goals.map((g) => <TeamGoalRow key={g.id} goal={g} onOpen={() => onOpen(g.id)} />)
                ) : (
                  <div className="px-2 py-1 text-sm" style={{ color: token.colorTextSecondary }}>
                    No goals yet.
                  </div>
                )}
              </Card>
            );
          })}
          {filter === 'attention' && !teamGoals.some(needsAttention) ? <Empty description="Nothing needs attention right now." /> : null}
        </div>
      )}
      <GoalFormModal open={adding} goal={null} owners={reports} onClose={() => setAdding(false)} />
    </>
  );
}

const SECTIONS = ['goals', 'reviews', 'team', 'to-write'] as const;
type Section = (typeof SECTIONS)[number];

/**
 * Me → Performance: my goals and reviews; my team's goals (when I manage anyone); the
 * reviews I'm to write. The section and an open review are in the URL (?section=team,
 * ?review=…), so a notification can link straight to a review.
 */
export function PerformanceTab() {
  const dispatch = useAppDispatch();
  const me = useAppSelector(selectAuthUser)!;
  const people = useAppSelector(selectPeople);
  const { toWrite } = useAppSelector(selectPerformance);
  const [params, setParams] = useSearchParams();
  const today = dayjs().format('YYYY-MM-DD');
  const hasTeam = people.some((p) => p.reportsTo === me.id);
  const available: Section[] = ['goals', 'reviews', ...(hasTeam ? (['team'] as const) : []), ...(toWrite.length ? (['to-write'] as const) : [])];
  const requested = SECTIONS.find((s) => s === params.get('section'));
  const section: Section = requested && available.includes(requested) ? requested : 'goals';
  const reviewId = params.get('review');

  const refreshReviews = () => {
    void dispatch(fetchMyReviews());
    void dispatch(fetchReviewsToWrite());
  };

  useEffect(() => {
    void dispatch(fetchMyGoals());
    void dispatch(fetchPeople());
    refreshReviews();
    return () => {
      dispatch(closeGoal());
      dispatch(closeReview());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);
  useEffect(() => {
    if (hasTeam) void dispatch(fetchTeamGoals());
  }, [dispatch, hasTeam]);

  // The review drawer follows ?review=.
  useEffect(() => {
    if (!reviewId) {
      dispatch(closeReview());
      return;
    }
    void dispatch(openReview(reviewId)).then((result) => {
      if (openReview.rejected.match(result)) void message.error(result.payload ?? 'Could not open the review');
    });
  }, [dispatch, reviewId]);

  const setParam = (key: string, value: string | null) =>
    setParams(
      (p) => {
        if (value === null) p.delete(key);
        else p.set(key, value);
        return p;
      },
      { replace: key === 'section' }
    );

  const open = async (id: string) => {
    const result = await dispatch(openGoal(id));
    if (openGoal.rejected.match(result)) void message.error(result.payload?.message ?? 'Could not open the goal');
  };

  return (
    <>
      <Tabs
        activeKey={section}
        onChange={(key) => setParam('section', key === 'goals' ? null : key)}
        items={[
          { key: 'goals', label: 'My goals', children: <MyGoals onOpen={open} /> },
          { key: 'reviews', label: 'My reviews', children: <MyReviews onOpen={(id) => setParam('review', id)} today={today} /> },
          ...(hasTeam ? [{ key: 'team', label: 'My team', children: <MyTeam onOpen={open} /> }] : []),
          ...(toWrite.length
            ? [{ key: 'to-write', label: `Reviews to write (${toWrite.filter((r) => r.managerStatus !== 'submitted').length})`, children: <ReviewsToWrite onOpen={(id) => setParam('review', id)} today={today} /> }]
            : []),
        ]}
      />
      <GoalDrawer />
      <ReviewDrawer onClose={() => setParam('review', null)} onChanged={refreshReviews} />
    </>
  );
}
