import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/setup';
import { API_BASE_URL } from '../../../services/api';
import { makeTestStore } from '../../../test/makeTestStore';
import { memberAuth } from '../../../test/fixtures';
import { lcPerson } from '../../../test/lifecycleFixtures';
import type { GoalCheckIn, GoalDetail, GoalStatus } from '../../../types/performance';
import MePage from '../MePage';

const ME = 'u1';
const IVY = lcPerson('u1', 'Ivy Mehta', { reportsTo: 'u9' });
const MIA = lcPerson('u9', 'Mia Shah');
const RAJ = lcPerson('r1', 'Raj Patel', { reportsTo: ME, jobTitle: 'Sales' });
const ZOE = lcPerson('z1', 'Zoe Khan', { reportsTo: ME });

type Stored = GoalDetail & { createdById: string };
let goals: Stored[];
let people = [IVY, MIA, RAJ, ZOE];
let requests: { method: string; path: string; body?: unknown }[];

function goal(id: string, extra: Partial<Stored> = {}): Stored {
  return {
    id,
    ownerId: ME,
    owner: IVY,
    title: `Goal ${id}`,
    description: '',
    startDate: '2026-10-01',
    dueDate: '2026-12-31',
    weight: null,
    progress: 0,
    status: 'on_track',
    overdue: false,
    lastCheckInAt: null,
    checkInCount: 0,
    createdByName: 'Ivy Mehta',
    createdById: ME,
    createdAt: '2026-10-01T05:00:00.000Z',
    updatedAt: '2026-10-01T05:00:00.000Z',
    relation: 'owner',
    canDelete: true,
    checkIns: [],
    ...extra,
  };
}

/** What the server says about a goal to me (u1). */
function asMe(g: Stored): GoalDetail {
  const relation = g.ownerId === ME ? 'owner' : 'manager';
  const { createdById, ...rest } = g;
  return { ...rest, relation, canDelete: g.checkInCount === 0 && (relation !== 'owner' || createdById === ME) };
}
const listView = (g: Stored) => {
  const { relation: _r, canDelete: _c, checkIns: _ci, createdById: _cb, ...row } = asMe(g) as Stored;
  return row;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 5, 10, 0));
  people = [IVY, MIA, RAJ, ZOE];
  requests = [];
  goals = [
    goal('g1', { title: 'Launch onboarding', weight: 60, progress: 40, status: 'at_risk', checkInCount: 1, createdByName: 'Mia Shah', createdById: 'u9', checkIns: [] }),
    goal('g2', { title: 'Write the docs', weight: 20, progress: 100, status: 'completed', checkInCount: 2 }),
    goal('g3', { title: 'Old target', dueDate: '2026-09-30', overdue: true }),
    goal('t1', { ownerId: 'r1', owner: RAJ, title: 'Close Q4 deals', status: 'behind', progress: 20, checkInCount: 1 }),
    goal('t2', { ownerId: 'r1', owner: RAJ, title: 'Train new hires', progress: 50, checkInCount: 1 }),
  ];
  const ok = (data: unknown, status = 200) => HttpResponse.json({ success: true, data }, { status });
  const find = (id: unknown) => goals.find((g) => g.id === id)!;
  server.use(
    http.get(`${API_BASE_URL}/people`, () => ok(people)),
    http.get(`${API_BASE_URL}/leave/balances`, () => ok([])),
    http.get(`${API_BASE_URL}/leave/requests/mine`, () => ok([])),
    http.get(`${API_BASE_URL}/reviews/mine`, () => ok([])),
    http.get(`${API_BASE_URL}/reviews/to-write`, () => ok([])),
    http.get(`${API_BASE_URL}/goals/mine`, () => ok(goals.filter((g) => g.ownerId === ME).map(listView))),
    http.get(`${API_BASE_URL}/goals/team`, () => ok(goals.filter((g) => g.ownerId !== ME).map(listView))),
    http.get(`${API_BASE_URL}/goals/:id`, ({ params }) => ok(asMe(find(params.id)))),
    http.post(`${API_BASE_URL}/goals`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      requests.push({ method: 'POST', path: '/goals', body });
      const owner = people.find((p) => p.id === (body.ownerId ?? ME))!;
      const created = goal(`n${goals.length}`, { ...(body as Partial<Stored>), ownerId: owner.id, owner });
      goals.push(created);
      return ok(asMe(created), 201);
    }),
    http.put(`${API_BASE_URL}/goals/:id`, async ({ params, request }) => {
      const body = await request.json();
      requests.push({ method: 'PUT', path: `/goals/${params.id}`, body });
      Object.assign(find(params.id), body);
      return ok(asMe(find(params.id)));
    }),
    http.delete(`${API_BASE_URL}/goals/:id`, ({ params }) => {
      requests.push({ method: 'DELETE', path: `/goals/${params.id}` });
      goals = goals.filter((g) => g.id !== params.id);
      return ok({ id: params.id, deleted: true });
    }),
    http.post(`${API_BASE_URL}/goals/:id/check-ins`, async ({ params, request }) => {
      const body = (await request.json()) as { progress: number; status: GoalStatus; comment: string };
      requests.push({ method: 'POST', path: `/goals/${params.id}/check-ins`, body });
      const g = find(params.id);
      const entry: GoalCheckIn = { id: `c${g.checkInCount + 1}`, authorName: 'Ivy Mehta', previousProgress: g.progress, previousStatus: g.status, createdAt: '2026-10-05T05:00:00.000Z', ...body };
      Object.assign(g, { progress: body.progress, status: body.status, checkInCount: g.checkInCount + 1, checkIns: [entry, ...g.checkIns] });
      return ok(asMe(g), 201);
    })
  );
});
afterEach(() => {
  vi.useRealTimers();
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderTab(plan: 'basic' | 'professional' = 'professional', url = '/me/performance') {
  render(
    <Provider store={makeTestStore({ auth: memberAuth(plan) })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/me/:tab" element={<><MePage /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

const drawer = () => document.querySelector('.ant-drawer-open') as HTMLElement;
const modal = () => [...document.querySelectorAll('.ant-modal')].at(-1) as HTMLElement;
const card = (title: string) => screen.getByRole('button', { name: `Open ${title}` }).closest('[data-testid="goal-card"]') as HTMLElement;
const last = (path: string) => requests.filter((r) => r.path === path).at(-1);

async function openGoalNamed(title: string) {
  await userEvent.click(await screen.findByRole('button', { name: `Open ${title}` }));
  await waitFor(() => expect(drawer()).toBeTruthy());
  await within(drawer()).findByText(title);
}

describe('Me → Performance: my goals', () => {
  it('lists my goals with their weights, and adds one', async () => {
    renderTab();
    await screen.findByRole('button', { name: 'Open Launch onboarding' });
    expect(screen.getByText('Weights add up to 80% (100% is usual).')).toBeInTheDocument();
    expect(within(card('Launch onboarding')).getByText('At risk')).toBeInTheDocument();
    expect(within(card('Launch onboarding')).getByText('Weight 60%')).toBeInTheDocument();
    expect(within(card('Old target')).getByText('Overdue · was due 30 Sep')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /New goal/ }));
    await userEvent.click(within(modal()).getByRole('button', { name: 'Save' }));
    expect(within(modal()).getByText('Give the goal a title')).toBeInTheDocument();
    expect(within(modal()).getByText('Choose a due date')).toBeInTheDocument();

    await userEvent.click(within(modal()).getByLabelText('Goal'));
    await userEvent.paste('Mentor two juniors');
    await userEvent.type(within(modal()).getByLabelText('Due'), '2026-09-01{enter}');
    await userEvent.click(within(modal()).getByRole('button', { name: 'Save' }));
    expect(within(modal()).getByText('The due date can’t be before the start date')).toBeInTheDocument();

    const due = within(modal()).getByLabelText('Due');
    await userEvent.clear(due);
    await userEvent.type(due, '2026-12-15{enter}');
    await userEvent.click(within(modal()).getByLabelText('Weight (optional)'));
    await userEvent.paste('15');
    await userEvent.click(within(modal()).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(last('/goals')?.body).toEqual({ title: 'Mentor two juniors', description: '', startDate: '2026-10-05', dueDate: '2026-12-15', weight: 15 })
    );
    expect(await screen.findByRole('button', { name: 'Open Mentor two juniors' })).toBeInTheDocument();
  });

  it('checks in, keeps the history, suggests completing at 100%, and cancels', async () => {
    renderTab();
    await openGoalNamed('Launch onboarding');
    const progress = within(drawer()).getByLabelText('Progress');
    await userEvent.clear(progress);
    await userEvent.type(progress, '70');
    await userEvent.click(within(drawer()).getByLabelText('Status'));
    await userEvent.click(await screen.findByTitle('On track'));
    await userEvent.click(within(drawer()).getByLabelText('Comment (optional)'));
    await userEvent.paste('Templates shipped');
    await userEvent.click(within(drawer()).getByRole('button', { name: 'Check in' }));

    await waitFor(() => expect(last('/goals/g1/check-ins')?.body).toEqual({ progress: 70, status: 'on_track', comment: 'Templates shipped' }));
    const [entry] = await within(drawer()).findAllByTestId('check-in');
    expect(entry).toHaveTextContent('Ivy Mehta · 40% → 70% · At risk → On track');
    expect(entry).toHaveTextContent('“Templates shipped”');
    await waitFor(() => expect(within(card('Launch onboarding')).getByText('On track')).toBeInTheDocument());

    await userEvent.clear(within(drawer()).getByLabelText('Progress'));
    await userEvent.type(within(drawer()).getByLabelText('Progress'), '100');
    await userEvent.click(within(drawer()).getByRole('button', { name: 'Mark it completed?' }));
    expect(within(drawer()).getByTitle('Completed')).toBeInTheDocument();

    await userEvent.click(within(drawer()).getByLabelText('Status'));
    await userEvent.click(await screen.findByTitle('Cancelled'));
    expect(within(drawer()).getByText('Cancelling keeps the goal and its history; a later check-in reopens it.')).toBeInTheDocument();
    await userEvent.click(within(drawer()).getByRole('button', { name: 'Cancel goal' }));
    await waitFor(() => expect(last('/goals/g1/check-ins')?.body).toMatchObject({ status: 'cancelled' }));
    expect(await screen.findByText('Goal cancelled')).toBeInTheDocument();
  });

  it('edits a goal, and deletes only one nothing has been recorded against', async () => {
    renderTab();
    await openGoalNamed('Launch onboarding');
    // Set by Mia, with a check-in: no Delete.
    expect(within(drawer()).queryByRole('button', { name: 'Delete goal' })).not.toBeInTheDocument();
    expect(within(drawer()).getByText('Mia Shah')).toBeInTheDocument();
    await userEvent.click(within(drawer()).getByRole('button', { name: /Edit/ }));
    const title = within(modal()).getByLabelText('Goal');
    await userEvent.clear(title);
    await userEvent.paste('Launch onboarding v1');
    await userEvent.click(within(modal()).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(last('/goals/g1')?.body).toEqual({ title: 'Launch onboarding v1', description: '', startDate: '2026-10-01', dueDate: '2026-12-31', weight: 60 })
    );
    await userEvent.click(within(drawer()).getByRole('button', { name: 'Close' }));

    await openGoalNamed('Old target');
    await userEvent.click(within(drawer()).getByRole('button', { name: 'Delete goal' }));
    const confirm = (await screen.findByText('Delete “Old target”?', { selector: '.ant-modal-confirm-title' })).closest('.ant-modal') as HTMLElement;
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open Old target' })).not.toBeInTheDocument());
    expect(last('/goals/g3')).toMatchObject({ method: 'DELETE' });
  });
});

describe('Me → Performance: my team', () => {
  it("shows my reports' goals by person, filters to those needing attention, and sets a goal for one", async () => {
    renderTab('professional', '/me/performance?section=team');
    const members = await screen.findAllByTestId('team-member');
    expect(members.map((m) => within(m).getByText(/Raj Patel|Zoe Khan/).textContent)).toEqual(['Raj Patel', 'Zoe Khan']);
    await waitFor(() => expect(members[0]).toHaveTextContent('Close Q4 deals'));
    expect(members[0]).toHaveTextContent('Train new hires');
    expect(members[1]).toHaveTextContent('No goals yet.');

    await userEvent.click(screen.getByText('Needs attention (1)'));
    const attention = screen.getAllByTestId('team-member');
    expect(attention).toHaveLength(1);
    expect(attention[0]).toHaveTextContent('Close Q4 deals');
    expect(attention[0]).not.toHaveTextContent('Train new hires');

    await openGoalNamed('Close Q4 deals');
    expect(within(drawer()).getByText('Raj Patel’s goal')).toBeInTheDocument();
    await userEvent.click(within(drawer()).getByRole('button', { name: 'Close' }));

    await userEvent.click(screen.getByRole('button', { name: /New goal for/ }));
    await userEvent.click(within(modal()).getByRole('button', { name: 'Save' }));
    expect(within(modal()).getByText('Choose whose goal it is')).toBeInTheDocument();
    await userEvent.click(within(modal()).getByLabelText('For'));
    await userEvent.click(await screen.findByTitle('Zoe Khan'));
    await userEvent.click(within(modal()).getByLabelText('Goal'));
    await userEvent.paste('Shadow three sales calls');
    await userEvent.type(within(modal()).getByLabelText('Due'), '2026-11-30{enter}');
    await userEvent.click(within(modal()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(last('/goals')?.body).toMatchObject({ ownerId: 'z1', title: 'Shadow three sales calls' }));
    await userEvent.click(screen.getByText('All goals'));
    await waitFor(() => expect(screen.getAllByTestId('team-member')[1]).toHaveTextContent('Shadow three sales calls'));
  });

  it('has no My team section for someone without reports', async () => {
    people = [IVY, MIA];
    renderTab();
    await screen.findByRole('button', { name: 'Open Launch onboarding' });
    expect(screen.queryByRole('tab', { name: 'My team' })).not.toBeInTheDocument();
  });
});

describe('the plan', () => {
  it('has no Performance on Basic', async () => {
    renderTab('basic');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/me/leave'));
    expect(screen.queryByRole('tab', { name: /Performance/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Expenses/ })).toBeInTheDocument();
  });
});
