import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { attendanceBackground } from '../../test/attendanceFixtures';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import { activeSubscription } from '../../test/fixtures';
import type { AuthState } from '../../store/auth/authSlice';
import type { Announcement } from '../../types/announcement';
import type { EffectivePermissions, UserRoleName } from '../../types/auth';
import type { HomeSummary } from '../../types/home';
import type { Introduction, IntroductionCard } from '../../types/people';
import type { Post, PostComment } from '../../types/post';
import type { AssignedGroup, LifecycleTask, MyLifecycle } from '../../types/lifecycle';
import { assignedGroup, lcPerson, lcTask, myProcess } from '../../test/lifecycleFixtures';
import dayjs from 'dayjs';
import HomePage from './HomePage';

const NOW = new Date().toISOString();

function person(id: string, name: string, extra: Partial<IntroductionCard> = {}): IntroductionCard {
  return {
    id,
    name,
    jobTitle: `${name.split(' ')[0]}'s title`,
    departmentName: 'Engineering',
    avatarUrl: null,
    role: 'ORG_USER',
    reportsTo: null,
    joiningDate: '2025-01-01',
    introduction: { about: '', hobbies: '', lovesAboutJob: '' },
    isNewJoiner: false,
    hasIntroduction: false,
    ...extra,
  };
}

function announcement(id: string, title: string, extra: Partial<Announcement> = {}): Announcement {
  return { id, title, body: `${title} body`, pinned: false, expiresOn: null, expired: false, createdAt: NOW, updatedAt: NOW, createdByName: 'Ann Admin', ...extra };
}

function summary(extra: Partial<HomeSummary> = {}): HomeSummary {
  return {
    today: '2026-10-05',
    week: { from: '2026-10-05', to: '2026-10-11' },
    upcomingHolidays: [
      { id: 'h1', name: 'Dussehra', date: '2026-10-20', description: '' },
      { id: 'h2', name: 'Diwali', date: '2026-11-08', description: '' },
    ],
    onLeaveToday: [
      { employeeId: 'u7', name: 'Raj Patel', avatarUrl: null, jobTitle: 'Designer', leaveTypeName: 'Paid Leave', halfDay: 'second' },
    ],
    teamOnLeave: {
      size: 3,
      today: [{ ...person('u7', 'Raj Patel'), halfDay: 'second' }],
      thisWeek: [{ person: person('u8', 'Maya Shah'), dates: ['2026-10-08', '2026-10-09'] }],
    },
    announcements: [announcement('a1', 'Office closed Friday', { pinned: true }), announcement('a2', 'Welcome Ivy')],
    balances: [
      { leaveTypeId: 't1', name: 'Paid Leave', code: 'PL', isPaid: true, allowHalfDay: true, yearlyQuota: 12, approved: 3, pending: 1, available: 8 },
      { leaveTypeId: 't2', name: 'Unpaid Leave', code: 'UL', isPaid: false, allowHalfDay: true, yearlyQuota: null, approved: 0, pending: 0, available: null },
    ],
    moduleCounts: null,
    pendingApprovals: null,
    celebrations: { today: [], upcoming: [] },
    ...extra,
  };
}

function post(id: string, body: string, extra: Partial<Post> = {}): Post {
  return {
    id,
    authorId: 'u2',
    authorName: 'Raj Patel',
    authorAvatarUrl: null,
    authorJobTitle: 'Designer',
    body,
    createdAt: NOW,
    likeCount: 0,
    likedByMe: false,
    commentCount: 0,
    canDelete: false,
    praise: null,
    ...extra,
  };
}

/** A tiny in-memory backend for Home. Tests tweak `db` before rendering. */
let db: {
  summary: HomeSummary;
  posts: Post[];
  pages: Record<string, { items: Post[]; nextCursor: string | null }>;
  comments: Record<string, PostComment[]>;
  intro: Introduction;
  introductions: IntroductionCard[];
  likeFails: boolean;
  requests: { method: string; path: string; body?: unknown }[];
};

beforeEach(() => {
  db = {
    summary: summary(),
    posts: [post('p1', 'Shipped the new onboarding flow!', { likeCount: 2, commentCount: 1 })],
    pages: {},
    comments: { p1: [{ id: 'c1', postId: 'p1', authorId: 'u3', authorName: 'Maya Shah', authorAvatarUrl: null, authorJobTitle: null, body: 'Great work!', createdAt: NOW, canDelete: false }] },
    intro: { about: '', hobbies: '', lovesAboutJob: '' },
    introductions: [],
    likeFails: false,
    requests: [],
  };
  const ok = (data: unknown, status = 200) => HttpResponse.json({ success: true, data }, { status });
  server.use(
    ...attendanceBackground,
    http.get(`${API_BASE_URL}/home/summary`, () => ok(db.summary)),
    http.get(`${API_BASE_URL}/posts`, ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      if (cursor) return ok(db.pages[cursor]);
      return ok({ items: db.posts, nextCursor: db.pages.first ? 'first' : null });
    }),
    http.post(`${API_BASE_URL}/posts`, async ({ request }) => {
      const body = (await request.json()) as { body: string; praise?: { recipientIds: string[]; badge: 'teamwork' } };
      db.requests.push({ method: 'POST', path: '/posts', body });
      const praise = body.praise
        ? { badge: body.praise.badge, recipients: body.praise.recipientIds.map((id) => ({ id, name: id === 'u7' ? 'Raj Patel' : 'Maya Shah', avatarUrl: null, jobTitle: null })) }
        : null;
      return ok(post('new', body.body, { authorId: 'u1', authorName: 'Ivy Mehta', canDelete: true, praise }), 201);
    }),
    http.get(`${API_BASE_URL}/people`, () =>
      ok([person('u1', 'Ivy Mehta'), person('u7', 'Raj Patel', { jobTitle: 'Designer' }), person('u8', 'Maya Shah')])
    ),
    http.delete(`${API_BASE_URL}/posts/:id`, ({ params }) => {
      db.requests.push({ method: 'DELETE', path: `/posts/${params.id}` });
      return ok({ id: params.id, deleted: true });
    }),
    http.post(`${API_BASE_URL}/posts/:id/like`, ({ params }) => {
      db.requests.push({ method: 'POST', path: `/posts/${params.id}/like` });
      if (db.likeFails) return HttpResponse.json({ success: false, error: { message: 'Server hiccup' } }, { status: 500 });
      const p = db.posts.find((x) => x.id === params.id)!;
      p.likedByMe = !p.likedByMe;
      p.likeCount += p.likedByMe ? 1 : -1;
      return ok({ likeCount: p.likeCount, likedByMe: p.likedByMe });
    }),
    http.get(`${API_BASE_URL}/posts/:id/comments`, ({ params }) => ok(db.comments[params.id as string] ?? [])),
    http.post(`${API_BASE_URL}/posts/:id/comments`, async ({ params, request }) => {
      const { body } = (await request.json()) as { body: string };
      const list = (db.comments[params.id as string] ??= []);
      const comment: PostComment = { id: `c${list.length + 10}`, postId: params.id as string, authorId: 'u1', authorName: 'Ivy Mehta', authorAvatarUrl: null, authorJobTitle: null, body, createdAt: NOW, canDelete: true };
      list.push(comment);
      return ok({ comment, commentCount: list.length }, 201);
    }),
    http.get(`${API_BASE_URL}/me/introduction`, () => ok(db.intro)),
    http.put(`${API_BASE_URL}/me/introduction`, async ({ request }) => {
      db.intro = { ...db.intro, ...((await request.json()) as Partial<Introduction>) };
      db.requests.push({ method: 'PUT', path: '/me/introduction', body: db.intro });
      return ok(db.intro);
    }),
    http.get(`${API_BASE_URL}/people/introductions`, () => ok(db.introductions)),
    http.post(`${API_BASE_URL}/announcements`, async ({ request }) => {
      const body = (await request.json()) as Partial<Announcement>;
      db.requests.push({ method: 'POST', path: '/announcements', body });
      const created = announcement('a9', body.title!, body);
      db.summary = { ...db.summary, announcements: [...db.summary.announcements, created] };
      return ok(created, 201);
    })
  );
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderHome(role: UserRoleName = 'ORG_USER', permissions: EffectivePermissions = { scope: 'none' }, url = '/home', plan: 'basic' | 'professional' = 'basic') {
  const auth: AuthState = {
    user: { id: 'u1', name: 'Ivy Mehta', email: 'ivy@x.com', role, organizationId: 'o1', roleId: null, mustChangePassword: false, permissions, subscription: activeSubscription(plan) },
    status: 'authenticated',
    bootstrapped: true,
    error: null,
    resetToken: null,
  };
  render(
    <Provider store={makeTestStore({ auth })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route
            path="/home"
            element={
              <>
                <HomePage />
                <LocationProbe />
              </>
            }
          />
          <Route path="/employees" element={<div>Employees Page</div>} />
          <Route path="/me/:tab" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

function card(title: string) {
  return screen.getByText(title).closest('.ant-card') as HTMLElement;
}

describe('Home dashboard', () => {
  it('greets the user and fills every side card from the summary', async () => {
    renderHome();
    expect(screen.getByText(/, Ivy 👋/)).toBeInTheDocument();

    expect(await screen.findByText('Dussehra')).toBeInTheDocument();
    expect(screen.getByText('Diwali')).toBeInTheDocument();
    expect(within(card('On leave today')).getByText('Raj Patel')).toBeInTheDocument();
    expect(within(card('On leave today')).getByText('Second half')).toBeInTheDocument();
    expect(within(card('My team on leave')).getByText('Maya Shah')).toBeInTheDocument();
    expect(within(card('My team on leave')).getByText('Thu, 8 Oct')).toBeInTheDocument();
    expect(within(card('My leave balance')).getByText('8')).toBeInTheDocument();
    expect(within(card('My leave balance')).getByText('Unlimited')).toBeInTheDocument();
    expect(within(card('Announcements')).getByText('Office closed Friday')).toBeInTheDocument();
    expect(within(card('Announcements')).getByText('Pinned')).toBeInTheDocument();
    // An ORG_USER without dashboard read gets no counts and no admin actions.
    expect(screen.queryByText('At a glance')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new announcement/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit office closed friday/i })).not.toBeInTheDocument();
  });

  it('shows friendly empty states', async () => {
    db.summary = summary({ upcomingHolidays: [], onLeaveToday: [], teamOnLeave: { size: 0, today: [], thisWeek: [] }, announcements: [] });
    db.posts = [];
    renderHome();
    expect(await screen.findByText("No one's on leave today 🎉")).toBeInTheDocument();
    expect(screen.getByText('No upcoming holidays')).toBeInTheDocument();
    expect(screen.getByText("You're not in a team yet. Ask your admin to set your manager.")).toBeInTheDocument();
    expect(await screen.findByText(/no posts yet/i)).toBeInTheDocument();
    // Members don't see an empty announcements card.
    expect(screen.queryByText('Announcements')).not.toBeInTheDocument();
  });

  it('shows module counts when the summary has them, and they link to the module', async () => {
    db.summary = summary({ moduleCounts: { employees: 12, documents: 4, projects: null, tasks: null } });
    renderHome('ORG_ADMIN', { scope: 'all' });
    expect(await screen.findByText('At a glance')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Employees: 12' }));
    expect(await screen.findByText('Employees Page')).toBeInTheDocument();
  });

  it('lets an ORG_ADMIN publish an announcement', async () => {
    renderHome('ORG_ADMIN', { scope: 'all' });
    await screen.findByText('Office closed Friday');
    await userEvent.click(screen.getByRole('button', { name: /new announcement/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /publish/i }));
    expect(await within(dialog).findByText('Title is required')).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText('Title'), 'Town hall at 4pm');
    await userEvent.type(within(dialog).getByLabelText('Message'), 'Everyone welcome');
    await userEvent.click(within(dialog).getByText('Pin to the top'));
    await userEvent.click(within(dialog).getByRole('button', { name: /publish/i }));

    await waitFor(() =>
      expect(db.requests.find((r) => r.path === '/announcements')?.body).toEqual({ title: 'Town hall at 4pm', body: 'Everyone welcome', pinned: true, expiresOn: null })
    );
    // The summary is reloaded, so the new one shows.
    expect(await screen.findByText('Town hall at 4pm')).toBeInTheDocument();
  });
});

describe('Apply leave from Home', () => {
  it('opens the drawer from the greeting and from the balance card', async () => {
    server.use(http.get(`${API_BASE_URL}/leave/balances`, () => HttpResponse.json({ success: true, data: db.summary.balances })));
    renderHome();
    await screen.findByText('Dussehra');
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/me/holidays');

    await userEvent.click(screen.getByRole('button', { name: /apply leave/i }));
    expect(await screen.findByText('Apply for leave')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Apply for leave')).not.toBeInTheDocument());

    await userEvent.click(within(card('My leave balance')).getByRole('button', { name: /apply/i }));
    expect(await screen.findByText('Apply for leave')).toBeInTheDocument();
  });
});

describe('Expenses on Home', () => {
  const mine = (status: string, totalPaise: number, extra: Record<string, unknown> = {}) => ({
    id: `${status}-${totalPaise}`,
    number: null,
    title: 'Claim',
    status,
    totalPaise,
    itemCount: 1,
    employeeId: 'u1',
    employeeName: 'Ivy Mehta',
    submittedAt: null,
    decidedByName: null,
    decidedAt: null,
    decisionNote: '',
    paidByName: null,
    paidAt: null,
    paidOn: null,
    paymentReference: '',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    ...extra,
  });

  it('starts a new claim from the greeting', async () => {
    renderHome();
    await screen.findByText('Dussehra');
    await userEvent.click(screen.getByRole('button', { name: /new expense/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('/me/expenses?new=1');
  });

  it('shows what is awaiting approval and payment, and links to my expenses', async () => {
    server.use(
      http.get(`${API_BASE_URL}/expenses/mine`, () =>
        HttpResponse.json({
          success: true,
          data: [mine('submitted', 150000), mine('submitted', 25050), mine('approved', 99900), mine('draft', 5000), mine('paid', 70000, { paidOn: '2026-09-01' })],
        })
      )
    );
    renderHome();
    const expenses = await screen.findByTestId('expenses-card');
    expect(expenses).toHaveTextContent('Awaiting approval(2 claims)₹1,750.50');
    expect(expenses).toHaveTextContent('To be paid(1 claim)₹999.00');
    await userEvent.click(within(card('My expenses')).getByRole('button', { name: 'View' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/me\/expenses$/);
  });

  it('stays out of the way when nothing is in flight', async () => {
    let served = false;
    server.use(
      http.get(`${API_BASE_URL}/expenses/mine`, () => {
        served = true;
        return HttpResponse.json({ success: true, data: [mine('draft', 5000), mine('paid', 70000, { paidOn: '2026-09-01' }), mine('rejected', 1000)] });
      })
    );
    renderHome();
    await screen.findByText('Dussehra');
    await waitFor(() => expect(served).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('My expenses')).not.toBeInTheDocument();
  });
});

describe('Onboarding and offboarding on Home', () => {
  const day = (offset: number) => dayjs().add(offset, 'day').format('YYYY-MM-DD');
  const short = (offset: number) => dayjs().add(offset, 'day').format('ddd, D MMM');
  let mine: MyLifecycle[];
  let assigned: AssignedGroup[];
  let completedIds: string[];

  beforeEach(() => {
    mine = [];
    assigned = [];
    completedIds = [];
    const ok = (data: unknown) => HttpResponse.json({ success: true, data });
    server.use(
      http.get(`${API_BASE_URL}/lifecycle/mine`, () => ok(mine)),
      http.get(`${API_BASE_URL}/lifecycle/tasks/assigned-to-me`, () => ok(assigned)),
      http.post(`${API_BASE_URL}/lifecycle/tasks/:id/complete`, ({ params }) => {
        completedIds.push(params.id as string);
        const all: LifecycleTask[] = [...mine.flatMap((p) => p.tasks), ...assigned.flatMap((g) => g.tasks)];
        const done = { ...all.find((t) => t.id === params.id)!, status: 'done' as const };
        // What the server would now say.
        assigned = assigned.map((g) => ({ ...g, tasks: g.tasks.filter((t) => t.id !== params.id) })).filter((g) => g.tasks.length);
        mine = mine.map((p) => ({ ...p, tasks: p.tasks.map((t) => (t.id === params.id ? done : t)) }));
        return ok(done);
      })
    );
  });

  it('welcomes a new joiner before day one, with their people, progress and checklist', async () => {
    mine = [
      myProcess({
        anchorDate: day(7),
        progress: { total: 8, done: 2, skipped: 0, pending: 6, overdue: 0 },
        tasks: [
          lcTask('t1', { title: 'Upload ID and address proof', type: 'upload', dueDate: day(7) }),
          lcTask('t2', { title: 'Introduce yourself', dueDate: day(8) }),
          lcTask('t3', { title: 'Read the company policies', type: 'acknowledge', dueDate: day(10), status: 'done' }),
        ],
      }),
    ];
    server.use(
      http.get(`${API_BASE_URL}/people/:id`, ({ params }) =>
        HttpResponse.json({
          success: true,
          data: {
            ...lcPerson(params.id as string, 'Mia Shah', { jobTitle: 'Engineering Manager' }),
            email: 'mia@acme.com',
            presence: 'in',
            wfh: false,
            manager: null,
            directReports: [],
            introduction: { about: '', hobbies: '', lovesAboutJob: '' },
            birthday: null,
            praiseCount: 0,
            recentPraise: [],
          },
        })
      )
    );
    renderHome();
    const welcome = await screen.findByTestId('welcome-aboard');
    expect(within(welcome).getByText('Welcome aboard, Ivy! 🎉')).toBeInTheDocument();
    expect(within(welcome).getByText(`You join on ${short(7)}, in 7 days.`)).toBeInTheDocument();
    expect(within(welcome).getByLabelText('25% of onboarding finished')).toBeInTheDocument();
    const rows = within(welcome).getAllByRole('button', { name: /: (Due|Done)/ });
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      `Upload ID and address proof: Due ${short(7)}`,
      `Introduce yourself: Due ${short(8)}`,
      'Read the company policies: Done',
    ]);

    // Meet the manager.
    await userEvent.click(within(welcome).getByRole('button', { name: 'Your manager: Mia Shah' }));
    expect(await screen.findByText('mia@acme.com')).toBeInTheDocument();
    expect(within(welcome).getByRole('button', { name: 'Your buddy: Bob Rao' })).toBeInTheDocument();
  });

  it('opens a task from the checklist and ticks it off', async () => {
    mine = [myProcess({ anchorDate: day(0), tasks: [lcTask('t2', { title: 'Introduce yourself', dueDate: day(1) })] })];
    renderHome();
    const welcome = await screen.findByTestId('welcome-aboard');
    expect(within(welcome).getByText('Today’s your first day!')).toBeInTheDocument();
    await userEvent.click(within(welcome).getByRole('button', { name: /Introduce yourself/ }));
    const drawer = await waitFor(() => document.querySelector('.ant-drawer-open') as HTMLElement);
    expect(within(drawer).getByText('Your onboarding')).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: /Mark as done/ }));
    expect(completedIds).toEqual(['t2']);
    await waitFor(() => expect(within(welcome).getByRole('button', { name: 'Introduce yourself: Done' })).toBeInTheDocument());
  });

  it('shows a leaver their last day and what is left', async () => {
    mine = [
      myProcess({
        id: 'p9',
        kind: 'offboarding',
        anchorDate: day(3),
        buddy: null,
        tasks: [
          lcTask('t7', { kind: 'offboarding', title: 'Knowledge handover notes', type: 'upload', dueDate: day(-4), overdue: true }),
          lcTask('t8', { kind: 'offboarding', title: 'Exit interview', type: 'form', questions: ['Why?'], dueDate: day(1) }),
        ],
      }),
    ];
    renderHome();
    expect(await screen.findByText(`Your last day: ${short(3)}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Knowledge handover notes: Overdue · ${short(-4)}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Exit interview: Due ${short(1)}` })).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-aboard')).not.toBeInTheDocument();
  });

  it('lists the tasks I do for others, by person, and drops one once done', async () => {
    assigned = [
      assignedGroup({
        processId: 'p2',
        anchorDate: day(2),
        employee: lcPerson('u2', 'Raj Patel'),
        tasks: [
          lcTask('a1', { processId: 'p2', employeeId: 'u2', title: 'Assign a buddy', assigneeKind: 'manager', dueDate: day(-1), overdue: true }),
          lcTask('a2', { processId: 'p2', employeeId: 'u2', title: 'First 1:1 meeting', assigneeKind: 'manager', dueDate: day(3) }),
        ],
      }),
      assignedGroup({
        processId: 'p3',
        kind: 'offboarding',
        anchorDate: day(-5),
        employee: lcPerson('u3', 'Zoe Khan'),
        tasks: [lcTask('a3', { processId: 'p3', employeeId: 'u3', kind: 'offboarding', title: 'Final settlement', dueDate: day(10) })],
      }),
    ];
    renderHome();
    const card = await screen.findByTestId('lifecycle-tasks');
    expect(within(card).getByRole('region', { name: "Raj Patel's onboarding" })).toHaveTextContent(`Joins ${short(2)}`);
    expect(within(card).getByRole('region', { name: "Zoe Khan's offboarding" })).toHaveTextContent(`Left ${short(-5)}`);
    expect(screen.getByText('1 overdue')).toBeInTheDocument();

    await userEvent.click(within(card).getByRole('button', { name: /Assign a buddy/ }));
    const drawer = await waitFor(() => document.querySelector('.ant-drawer-open') as HTMLElement);
    expect(within(drawer).getByText("Raj Patel's onboarding")).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: /Mark as done/ }));
    await waitFor(() => expect(within(card).queryByRole('button', { name: /Assign a buddy/ })).not.toBeInTheDocument());
    expect(within(card).getByRole('button', { name: /First 1:1 meeting/ })).toBeInTheDocument();
  });

  it('shows none of it when there is nothing to do', async () => {
    renderHome();
    await screen.findByText('Dussehra');
    expect(screen.queryByTestId('welcome-aboard')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lifecycle-tasks')).not.toBeInTheDocument();
    expect(screen.queryByText(/Your last day/)).not.toBeInTheDocument();
  });
});

describe('Performance on Home', () => {
  const day = (offset: number) => dayjs().add(offset, 'day').format('YYYY-MM-DD');
  const cycle = { id: 'c2', name: 'H2 2026', periodFrom: day(-90), periodTo: day(90), selfDueDate: day(5), managerDueDate: day(-1), status: 'launched' };
  let reviewCalls: number;

  beforeEach(() => {
    reviewCalls = 0;
    const ok = (data: unknown) => HttpResponse.json({ success: true, data });
    server.use(
      http.get(`${API_BASE_URL}/reviews/mine`, () => {
        reviewCalls += 1;
        return ok([{ id: 'r1', cycle, reviewer: null, selfStatus: 'draft', released: false, managerRating: null }]);
      }),
      http.get(`${API_BASE_URL}/reviews/to-write`, () =>
        ok([{ id: 'r3', cycle, employee: person('u7', 'Raj Patel'), selfStatus: 'submitted', managerStatus: 'not_started', released: false }])
      ),
      http.get(`${API_BASE_URL}/goals/mine`, () =>
        ok([
          { id: 'g1', title: 'Quiet goal', status: 'on_track', lastCheckInAt: null, createdAt: dayjs().subtract(45, 'day').toISOString(), progress: 10 },
          { id: 'g2', title: 'Fresh goal', status: 'on_track', lastCheckInAt: dayjs().subtract(3, 'day').toISOString(), createdAt: dayjs().subtract(60, 'day').toISOString(), progress: 50 },
        ])
      )
    );
  });

  it('lists the reviews I still have to write, soonest first, and goals without a recent check-in', async () => {
    renderHome('ORG_USER', { scope: 'none' }, '/home', 'professional');
    const card = await screen.findByTestId('performance-card');
    const items = within(card).getAllByRole('button').map((b) => b.textContent);
    expect(items).toEqual(['Review of Raj Patel (H2 2026)Overdue', `Your H2 2026 self reviewDue ${dayjs(day(5)).format('D MMM')}`, 'Check in']);
    expect(card).toHaveTextContent('1 goal hasn’t had a check-in for a month.');

    await userEvent.click(within(card).getByRole('button', { name: /Your H2 2026 self review/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/me/performance?review=r1');
  });

  it('is not on Basic', async () => {
    renderHome();
    await screen.findByText('Dussehra');
    expect(screen.queryByTestId('performance-card')).not.toBeInTheDocument();
    expect(reviewCalls).toBe(0);
  });
});

describe('Celebrations', () => {
  const celebrating = () =>
    summary({
      celebrations: {
        today: [
          { person: person('u5', 'Neha Joshi'), kind: 'birthday', date: '2026-10-05', years: null },
          { person: person('u1', 'Ivy Mehta'), kind: 'anniversary', date: '2026-10-05', years: 2 },
        ],
        upcoming: [{ person: person('u6', 'Omar Khan'), kind: 'anniversary', date: '2026-10-09', years: 3 }],
      },
    });

  it("lists today's and the coming week's, with Wish for others and a greeting for me", async () => {
    db.summary = celebrating();
    renderHome();
    const today = await screen.findAllByTestId('celebration-today');
    expect(within(today[0]).getByText('Neha Joshi')).toBeInTheDocument();
    expect(within(today[0]).getByText('🎂 Birthday today')).toBeInTheDocument();
    expect(within(today[1]).getByText('You')).toBeInTheDocument();
    expect(within(today[1]).getByText('🎉 2 years with us today')).toBeInTheDocument();
    expect(within(today[1]).getByText('Congratulations!')).toBeInTheDocument();
    expect(within(today[1]).queryByRole('button', { name: /wish/i })).not.toBeInTheDocument();
    const [soon] = screen.getAllByTestId('celebration-upcoming');
    expect(soon).toHaveTextContent('Omar Khan');
    expect(soon).toHaveTextContent('🎉 3 years with us');
    expect(soon).toHaveTextContent('Fri, 9 Oct');
  });

  it('fills the post box with a wish, ready to post', async () => {
    db.summary = celebrating();
    renderHome();
    await userEvent.click(await screen.findByRole('button', { name: 'Wish Neha Joshi' }));
    const box = screen.getByLabelText('Write a post');
    await waitFor(() => expect(box).toHaveValue('Happy birthday, Neha! 🎂🎉 '));
    expect(box).toHaveFocus();
    // The cursor is at the end, so what I add follows the wish.
    await userEvent.paste('Have a great one!');
    await userEvent.click(screen.getByRole('button', { name: /^(send )?post$/i }));
    await waitFor(() => expect(db.requests.find((r) => r.path === '/posts')?.body).toEqual({ body: 'Happy birthday, Neha! 🎂🎉 Have a great one!' }));
  });

  it('says when there is nothing this week', async () => {
    renderHome();
    expect(await screen.findByText('No birthdays or work anniversaries this week')).toBeInTheDocument();
  });
});

describe('Praise', () => {
  it('shows a praise as a highlighted card with the badge and who was praised', async () => {
    db.posts = [
      post('pr1', 'Thanks for the late-night fix!', {
        authorName: 'Maya Shah',
        praise: {
          badge: 'above_and_beyond',
          recipients: [
            { id: 'u7', name: 'Raj Patel', avatarUrl: null, jobTitle: null },
            { id: 'u1', name: 'Ivy Mehta', avatarUrl: null, jobTitle: null },
          ],
        },
      }),
      post('p2', 'An ordinary post'),
    ];
    renderHome();
    const [praiseCard, ordinary] = await screen.findAllByTestId('post-card');
    const banner = within(praiseCard).getByTestId('praise-banner');
    expect(banner).toHaveTextContent('🚀 Above & beyond');
    expect(banner).toHaveTextContent('Maya Shah praised Raj Patel and Ivy Mehta');
    expect(within(ordinary).queryByTestId('praise-banner')).not.toBeInTheDocument();
  });

  it('praises colleagues with a badge and a message', async () => {
    renderHome();
    await screen.findByText('Shipped the new onboarding flow!');
    await userEvent.click(screen.getByRole('button', { name: /praise/i }));
    const dialog = await screen.findByRole('dialog');
    const post = within(dialog).getByRole('button', { name: /post praise/i });
    expect(post).toBeDisabled();

    await userEvent.click(within(dialog).getByLabelText('Who are you praising?', { selector: 'input' }));
    // I'm not offered to myself.
    expect(screen.queryByTitle('Ivy Mehta')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByTitle('Raj Patel · Designer'));
    await userEvent.click(within(dialog).getByRole('radio', { name: /teamwork/i }));
    expect(within(dialog).getByRole('radio', { name: /teamwork/i })).toHaveAttribute('aria-checked', 'true');
    await userEvent.type(within(dialog).getByLabelText('Message'), 'Saved the release!');
    await userEvent.click(post);

    await waitFor(() =>
      expect(db.requests.filter((r) => r.path === '/posts').at(-1)?.body).toEqual({ body: 'Saved the release!', praise: { recipientIds: ['u7'], badge: 'teamwork' } })
    );
    const first = (await screen.findAllByTestId('post-card'))[0];
    expect(within(first).getByTestId('praise-banner')).toHaveTextContent('Ivy Mehta praised Raj Patel');
  });

  it("shows the server's reason when a praise is refused", async () => {
    renderHome();
    await screen.findByText('Shipped the new onboarding flow!');
    await userEvent.click(screen.getByRole('button', { name: /praise/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText('Who are you praising?', { selector: 'input' }));
    await userEvent.click(await screen.findByTitle(/^Maya Shah/));
    await userEvent.click(within(dialog).getByRole('radio', { name: /thank you/i }));
    await userEvent.type(within(dialog).getByLabelText('Message'), 'x');
    // Maya was disabled while the form was open.
    server.use(
      http.post(`${API_BASE_URL}/posts`, () =>
        HttpResponse.json({ success: false, error: { message: 'Validation failed', details: { fieldErrors: { praise: ['Only active colleagues in your organization can be praised'] } } } }, { status: 400 })
      )
    );
    await userEvent.click(within(dialog).getByRole('button', { name: /post praise/i }));
    expect(await within(dialog).findByText('Only active colleagues in your organization can be praised')).toBeInTheDocument();
  });
});

describe('Posts feed', () => {
  it('adds a new post to the top of the feed', async () => {
    renderHome();
    await screen.findByText('Shipped the new onboarding flow!');
    const postButton = screen.getByRole('button', { name: /^(send )?post$/i });
    expect(postButton).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Write a post'), 'Hello team!');
    await userEvent.click(postButton);

    await waitFor(() => expect(screen.getAllByTestId('post-card')).toHaveLength(2));
    expect(within(screen.getAllByTestId('post-card')[0]).getByText('Hello team!')).toBeInTheDocument();
    expect(screen.getByLabelText('Write a post')).toHaveValue('');
  });

  it('likes and unlikes, and rolls the like back when the server fails', async () => {
    renderHome();
    await screen.findByText('Shipped the new onboarding flow!');
    await userEvent.click(screen.getByRole('button', { name: 'Like' }));
    expect(await screen.findByRole('button', { name: 'Unlike' })).toHaveTextContent('3');
    await userEvent.click(screen.getByRole('button', { name: 'Unlike' }));
    expect(await screen.findByRole('button', { name: 'Like' })).toHaveTextContent('2');

    db.likeFails = true;
    await userEvent.click(screen.getByRole('button', { name: 'Like' }));
    expect(await screen.findByText('Server hiccup')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Like' })).toHaveTextContent('2'));
  });

  it('loads comments when opened and adds a reply', async () => {
    renderHome();
    await screen.findByText('Shipped the new onboarding flow!');
    await userEvent.click(screen.getByRole('button', { name: /1 comment/i }));
    expect(await screen.findByText('Great work!')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Write a comment'), 'Congrats!');
    await userEvent.click(screen.getByRole('button', { name: /reply/i }));
    expect(await screen.findByText('Congrats!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2 comments/i })).toBeInTheDocument();
  });

  it('offers Delete only where allowed, and removes the post after confirming', async () => {
    db.posts = [post('mine', 'My post', { authorId: 'u1', canDelete: true }), post('theirs', 'Their post')];
    renderHome();
    await screen.findByText('My post');
    const [mine, theirs] = screen.getAllByTestId('post-card');
    expect(within(theirs).queryByRole('button', { name: 'Delete post' })).not.toBeInTheDocument();

    await userEvent.click(within(mine).getByRole('button', { name: 'Delete post' }));
    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText('Your post and its comments will be removed.')).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('My post')).not.toBeInTheDocument());
    expect(db.requests).toContainEqual({ method: 'DELETE', path: '/posts/mine' });
  });

  it('lets an ORG_ADMIN remove someone else’s post', async () => {
    db.posts = [post('theirs', 'Their post', { canDelete: true })];
    renderHome('ORG_ADMIN', { scope: 'all' });
    await screen.findByText('Their post');
    await userEvent.click(screen.getByRole('button', { name: 'Delete post' }));
    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText("Raj Patel's post and its comments will be removed for everyone.")).toBeInTheDocument();
    // Close it: antd's static confirm outlives the test otherwise.
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('loads the next page with the cursor', async () => {
    db.pages.first = { items: [post('old', 'An older post')], nextCursor: null };
    renderHome();
    await screen.findByText('Shipped the new onboarding flow!');
    await userEvent.click(screen.getByRole('button', { name: /load more/i }));
    expect(await screen.findByText('An older post')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });
});

describe('Welcome tab', () => {
  it('follows the URL and orders new joiners first', async () => {
    db.introductions = [
      person('n1', 'Neha New', { isNewJoiner: true, joiningDate: '2026-09-20' }),
      person('o1', 'Omar Old', { hasIntroduction: true, introduction: { about: 'I build APIs', hobbies: '', lovesAboutJob: 'The team' } }),
    ];
    renderHome();
    await userEvent.click(screen.getByRole('tab', { name: /welcome/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('/home?tab=welcome');

    const strip = await screen.findByLabelText('New joiners');
    expect(within(strip).getByText('Neha New')).toBeInTheDocument();
    const grid = screen.getAllByTestId('introduction-card');
    expect(grid).toHaveLength(1);
    expect(within(grid[0]).getByText('I build APIs')).toBeInTheDocument();
    expect(within(grid[0]).getByText('What I love about my job')).toBeInTheDocument();
    // Empty answers are hidden.
    expect(within(grid[0]).queryByText('My hobbies')).not.toBeInTheDocument();
  });

  it('invites me to introduce myself, saves it and shows it', async () => {
    renderHome('ORG_USER', { scope: 'none' }, '/home?tab=welcome');
    await userEvent.click(await screen.findByRole('button', { name: /introduce yourself/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('About me'), 'Frontend dev from Pune');
    await userEvent.type(within(dialog).getByLabelText('My hobbies'), 'Chess');
    await userEvent.click(within(dialog).getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(db.requests.find((r) => r.path === '/me/introduction')?.body).toEqual({ about: 'Frontend dev from Pune', hobbies: 'Chess', lovesAboutJob: '' })
    );
    expect(await screen.findByText('Frontend dev from Pune')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });
});
