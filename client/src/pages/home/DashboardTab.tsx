import { Alert, Button, Card, Col, Row, Skeleton } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import dayjs from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApplyLeaveDrawer } from '../../components/ApplyLeaveDrawer/ApplyLeaveDrawer';
import { ClockCard } from '../../components/ClockCard/ClockCard';
import { LifecycleTaskDrawer } from '../../components/Lifecycle/LifecycleTaskDrawer';
import { PersonProfileDrawer } from '../../components/PeopleSearch/PersonProfileDrawer';
import { ROUTES } from '../../constants/routes';
import { useHasFeature } from '../../hooks/useHasFeature';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectAuthUser } from '../../store/auth/authSelectors';
import { selectExpenses } from '../../store/expenses/expensesSelectors';
import { fetchMyClaims } from '../../store/expenses/expensesThunks';
import { selectLifecycle } from '../../store/lifecycle/lifecycleSelectors';
import { fetchAssignedTasks, fetchMyLifecycle } from '../../store/lifecycle/lifecycleThunks';
import { selectPerformance } from '../../store/performance/performanceSelectors';
import { fetchMyGoals, fetchMyReviews, fetchReviewsToWrite } from '../../store/performance/performanceThunks';
import { selectHomeError, selectHomeLoading, selectHomeSummary } from '../../store/home/homeSelectors';
import { fetchHomeSummary } from '../../store/home/homeThunks';
import type { Announcement } from '../../types/announcement';
import type { LifecycleTask } from '../../types/lifecycle';
import { summarizeClaims } from '../../utils/expenseFormat';
import { whose } from '../../utils/lifecycleFormat';
import { AnnouncementFormModal } from './components/AnnouncementFormModal';
import { AnnouncementsCard } from './components/AnnouncementsCard';
import { CelebrationsCard } from './components/CelebrationsCard';
import { ExpensesCard } from './components/ExpensesCard';
import { Greeting } from './components/Greeting';
import { LastDayCard } from './components/LastDayCard';
import { LeaveBalanceCard } from './components/LeaveBalanceCard';
import { LifecycleTasksCard } from './components/LifecycleTasksCard';
import { PerformanceCard } from './components/PerformanceCard';
import { ModuleCountsCard } from './components/ModuleCountsCard';
import { OnLeaveTodayCard } from './components/OnLeaveTodayCard';
import { PostComposer } from './components/PostComposer';
import { PostFeed } from './components/PostFeed';
import { TeamOnLeaveCard } from './components/TeamOnLeaveCard';
import { UpcomingHolidaysCard } from './components/UpcomingHolidaysCard';
import { WelcomeAboardCard } from './components/WelcomeAboardCard';

type AnnouncementEditor = { open: false } | { open: true; record: Announcement | null };

export function DashboardTab() {
  const dispatch = useAppDispatch();
  const user = useAppSelector(selectAuthUser)!;
  const summary = useAppSelector(selectHomeSummary);
  const loading = useAppSelector(selectHomeLoading);
  const error = useAppSelector(selectHomeError);
  const { claims } = useAppSelector(selectExpenses);
  const lifecycle = useAppSelector(selectLifecycle);
  const navigate = useNavigate();
  const [openTask, setOpenTask] = useState<{ id: string; whose: string } | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const today = dayjs().format('YYYY-MM-DD');
  const composerRef = useRef<TextAreaRef>(null);
  const [editor, setEditor] = useState<AnnouncementEditor>({ open: false });
  const [applying, setApplying] = useState(false);
  const [prefill, setPrefill] = useState<{ text: string; key: number } | null>(null);
  const isAdmin = user.role === 'ORG_ADMIN';

  const hasFeature = useHasFeature();
  const withExpenses = hasFeature('expenses');
  const withOnboarding = hasFeature('onboarding');
  const withPerformance = hasFeature('performance');
  const performance = useAppSelector(selectPerformance);
  useEffect(() => {
    void dispatch(fetchHomeSummary());
    if (withExpenses) void dispatch(fetchMyClaims());
    if (withOnboarding) {
      void dispatch(fetchMyLifecycle());
      void dispatch(fetchAssignedTasks());
    }
    if (withPerformance) {
      void dispatch(fetchMyReviews());
      void dispatch(fetchReviewsToWrite());
      void dispatch(fetchMyGoals());
    }
  }, [dispatch, withExpenses, withOnboarding, withPerformance]);

  const onboarding = lifecycle.mine.find((p) => p.kind === 'onboarding');
  const offboarding = lifecycle.mine.find((p) => p.kind === 'offboarding');
  const openMine = (task: LifecycleTask) => setOpenTask({ id: task.id, whose: whose(task.kind, null, true) });
  const shownTask =
    [...lifecycle.mine.flatMap((p) => p.tasks), ...lifecycle.assigned.flatMap((g) => g.tasks)].find((t) => t.id === openTask?.id) ?? null;

  const expenses = summarizeClaims(claims, dayjs().format('YYYY'));

  const sideColumn = error ? (
    <Alert
      type="error"
      showIcon
      message={error}
      action={
        <Button size="small" onClick={() => dispatch(fetchHomeSummary())}>
          Retry
        </Button>
      }
    />
  ) : loading || !summary ? (
    <Card>
      <Skeleton active />
    </Card>
  ) : (
    <>
      <CelebrationsCard
        today={summary.celebrations.today}
        upcoming={summary.celebrations.upcoming}
        myId={user.id}
        onWish={(text) => setPrefill({ text, key: Date.now() })}
      />
      <OnLeaveTodayCard people={summary.onLeaveToday} />
      <TeamOnLeaveCard team={summary.teamOnLeave} />
      <UpcomingHolidaysCard holidays={summary.upcomingHolidays} today={summary.today} />
      <LeaveBalanceCard balances={summary.balances} onApply={() => setApplying(true)} />
      {expenses.awaiting.count + expenses.toBePaid.count > 0 ? (
        <ExpensesCard summary={expenses} onView={() => navigate(`${ROUTES.me}/expenses`)} />
      ) : null}
      <ModuleCountsCard counts={summary.moduleCounts} />
    </>
  );

  return (
    <>
      <Greeting
        name={user.name}
        isAdmin={isAdmin}
        onApplyLeave={() => setApplying(true)}
        onNewExpense={withExpenses ? () => navigate(`${ROUTES.me}/expenses?new=1`) : undefined}
        onNewPost={() => composerRef.current?.focus()}
        onNewAnnouncement={() => setEditor({ open: true, record: null })}
      />
      {onboarding ? (
        <WelcomeAboardCard
          process={onboarding}
          firstName={user.name.trim().split(/\s+/)[0] ?? user.name}
          today={today}
          onOpenTask={openMine}
          onOpenPerson={setProfileId}
        />
      ) : null}
      <Row gutter={16}>
        <Col xs={24} lg={16}>
          {summary ? (
            <AnnouncementsCard announcements={summary.announcements} isAdmin={isAdmin} onEdit={(record) => setEditor({ open: true, record })} />
          ) : null}
          <PostComposer name={user.name} avatarUrl={user.avatar?.url} inputRef={composerRef} prefill={prefill} />
          <PostFeed myId={user.id} myName={user.name} myAvatarUrl={user.avatar?.url} />
        </Col>
        <Col xs={24} lg={8}>
          <ClockCard />
          {offboarding ? <LastDayCard process={offboarding} today={today} onOpenTask={openMine} /> : null}
          {withPerformance ? (
            <PerformanceCard
              myReviews={performance.myReviews}
              toWrite={performance.toWrite}
              goals={performance.myGoals}
              today={today}
              onOpenReview={(id) => navigate(`${ROUTES.me}/performance?review=${id}`)}
              onOpenGoals={() => navigate(`${ROUTES.me}/performance`)}
            />
          ) : null}
          {lifecycle.assigned.length ? (
            <LifecycleTasksCard
              groups={lifecycle.assigned}
              today={today}
              onOpenTask={(task, group) => setOpenTask({ id: task.id, whose: whose(group.kind, group.employee?.name ?? null, false) })}
            />
          ) : null}
          {sideColumn}
        </Col>
      </Row>
      <ApplyLeaveDrawer open={applying} onClose={() => setApplying(false)} />
      <LifecycleTaskDrawer
        task={shownTask}
        whose={openTask?.whose ?? ''}
        today={today}
        onClose={() => setOpenTask(null)}
        onDone={() => {
          // Progress counts everyone's tasks, so ask again rather than guess.
          void dispatch(fetchMyLifecycle());
          void dispatch(fetchAssignedTasks());
        }}
      />
      <PersonProfileDrawer personId={profileId} onClose={() => setProfileId(null)} onOpenPerson={setProfileId} />
      {isAdmin ? (
        <AnnouncementFormModal
          open={editor.open}
          record={editor.open ? editor.record : null}
          onClose={() => setEditor({ open: false })}
        />
      ) : null}
    </>
  );
}
