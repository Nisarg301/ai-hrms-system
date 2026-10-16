import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import { adminAuth } from '../../test/expenseFixtures';
import { lcPerson, lcTask } from '../../test/lifecycleFixtures';
import type { LifecycleTask, ProcessDetail } from '../../types/lifecycle';
import LifecycleProcessesPage from './LifecycleProcessesPage';

const IVY = lcPerson('u1', 'Ivy Mehta', { reportsTo: 'u9' });
const RAJ = lcPerson('u2', 'Raj Patel');
const MIA = lcPerson('u9', 'Mia Shah');
const BOB = lcPerson('u8', 'Bob Rao');
const TODAY = '2026-10-05';

/** What the server derives: progress (and overdue) from the tasks. */
function withProgress(p: ProcessDetail): ProcessDetail {
  const tasks = p.tasks.map((t) => ({ ...t, overdue: t.status === 'pending' && t.dueDate < TODAY }));
  return {
    ...p,
    tasks,
    progress: {
      total: tasks.length,
      done: tasks.filter((t) => t.status === 'done').length,
      skipped: tasks.filter((t) => t.status === 'skipped').length,
      pending: tasks.filter((t) => t.status === 'pending').length,
      overdue: tasks.filter((t) => t.overdue).length,
    },
  };
}

function detail(id: string, extra: Partial<ProcessDetail> = {}): ProcessDetail {
  return withProgress({
    id,
    kind: 'onboarding',
    status: 'active',
    templateName: 'Standard onboarding',
    anchorDate: '2026-10-12',
    employee: IVY,
    manager: MIA,
    buddy: BOB,
    reason: null,
    adminNotes: null,
    progress: { total: 0, done: 0, skipped: 0, pending: 0, overdue: 0 },
    startedAt: '2026-10-01T05:00:00.000Z',
    startedByName: 'Ann Admin',
    completedAt: null,
    completedByName: null,
    accountDisabled: false,
    cancelledAt: null,
    cancelledReason: null,
    tasks: [],
    ...extra,
  });
}

let processes: ProcessDetail[];
let requests: { method: string; path: string; body?: unknown; query?: Record<string, string> }[];
let refuseComplete: string | null;

const ok = (data: unknown, meta?: object, status = 200) => HttpResponse.json({ success: true, data, meta }, { status });
const find = (id: unknown) => processes.find((p) => p.id === id)!;
const save = (p: ProcessDetail) => {
  processes = processes.map((x) => (x.id === p.id ? withProgress(p) : x));
  return find(p.id);
};
const processOfTask = (taskId: unknown) => processes.find((p) => p.tasks.some((t) => t.id === taskId))!;
const editTask = (taskId: unknown, patch: Partial<LifecycleTask>) => {
  const p = processOfTask(taskId);
  return save({ ...p, tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 5, 10, 0));
  requests = [];
  refuseComplete = null;
  processes = [
    detail('p1', {
      tasks: [
        lcTask('t1', { processId: 'p1', title: 'Create email and system accounts', assigneeKind: 'admin', assigneeId: null, assigneeName: null, dueDate: '2026-10-03' }),
        lcTask('t2', { processId: 'p1', title: 'Assign a buddy', assigneeKind: 'manager', assigneeId: 'u9', assigneeName: 'Mia Shah', dueDate: '2026-10-04', status: 'done' }),
        lcTask('t3', { processId: 'p1', title: 'Upload ID and address proof', type: 'upload', assigneeId: 'u1', assigneeName: 'Ivy Mehta', dueDate: '2026-10-12' }),
      ],
    }),
    detail('p5', {
      kind: 'offboarding',
      templateName: 'Standard offboarding',
      employee: MIA,
      manager: null,
      buddy: null,
      anchorDate: '2026-10-02',
      reason: 'resignation',
      adminNotes: 'Moving to Pune',
      tasks: [
        lcTask('t9', {
          processId: 'p5',
          kind: 'offboarding',
          employeeId: 'u9',
          title: 'Exit interview',
          type: 'form',
          questions: ['Why are you leaving?'],
          assigneeId: 'u9',
          assigneeName: 'Mia Shah',
          status: 'done',
          completedByName: 'Mia Shah',
          answers: [{ question: 'Why are you leaving?', text: 'Closer to family' }],
        }),
      ],
    }),
  ];
  const record = async (request: Request, path: string) => {
    const body = request.method === 'GET' ? undefined : await request.json().catch(() => undefined);
    requests.push({ method: request.method, path, body, query: Object.fromEntries(new URL(request.url).searchParams) });
    return body as Record<string, unknown>;
  };
  server.use(
    http.get(`${API_BASE_URL}/people`, () => ok([IVY, RAJ, MIA, BOB])),
    // Who can be onboarded: only Raj (new, and not onboarded yet).
    http.get(`${API_BASE_URL}/lifecycle/candidates`, ({ request }) => ok(new URL(request.url).searchParams.get('kind') === 'onboarding' ? [RAJ] : [IVY, RAJ, BOB])),
    http.get(`${API_BASE_URL}/checklist-templates`, () =>
      ok([
        { id: 't-on', name: 'Standard onboarding', kind: 'onboarding', isDefault: true, tasks: [{}, {}], updatedAt: '2026-09-30T00:00:00.000Z' },
        { id: 't-off', name: 'Standard offboarding', kind: 'offboarding', isDefault: true, tasks: [{}], updatedAt: '2026-09-30T00:00:00.000Z' },
      ])
    ),
    http.post(`${API_BASE_URL}/lifecycle/onboarding`, async ({ request }) => {
      const body = await record(request, '/lifecycle/onboarding');
      const created = detail('p-new', { employee: RAJ, manager: null, buddy: BOB, anchorDate: '2026-10-19', tasks: [lcTask('n1', { processId: 'p-new', employeeId: 'u2' })] });
      processes.push(created);
      void body;
      return ok(created, undefined, 201);
    }),
    http.put(`${API_BASE_URL}/lifecycle/tasks/:taskId`, async ({ request, params }) => {
      const body = await record(request, `/lifecycle/tasks/${params.taskId}`);
      const patch: Partial<LifecycleTask> = {};
      if ('assigneeId' in body) {
        const who = [IVY, RAJ, MIA, BOB].find((x) => x.id === body.assigneeId);
        Object.assign(patch, { assigneeId: body.assigneeId ?? null, assigneeName: who?.name ?? null, assigneeKind: body.assigneeId ? 'person' : 'admin' });
      }
      if (body.dueDate) patch.dueDate = body.dueDate as string;
      return ok(editTask(params.taskId, patch));
    }),
    http.post(`${API_BASE_URL}/lifecycle/tasks/:taskId/skip`, async ({ request, params }) => {
      const body = await record(request, `/lifecycle/tasks/${params.taskId}/skip`);
      return ok(editTask(params.taskId, { status: 'skipped', skipReason: body.reason as string }));
    }),
    http.get(`${API_BASE_URL}/lifecycle`, async ({ request }) => {
      await record(request, '/lifecycle');
      const q = Object.fromEntries(new URL(request.url).searchParams);
      const rows = processes.filter((p) => p.kind === q.kind && p.status === (q.status ?? 'active')).map(({ tasks: _t, ...row }) => row);
      return ok(rows, { page: 1, limit: 20, total: rows.length });
    }),
    http.get(`${API_BASE_URL}/lifecycle/:id`, ({ params }) => (find(params.id) ? ok(find(params.id)) : HttpResponse.json({ success: false, error: { message: 'Process not found' } }, { status: 404 }))),
    http.post(`${API_BASE_URL}/lifecycle/:id/tasks`, async ({ request, params }) => {
      const body = await record(request, `/lifecycle/${params.id}/tasks`);
      const p = find(params.id);
      return ok(save({ ...p, tasks: [...p.tasks, lcTask(`x${p.tasks.length}`, { processId: p.id, ...(body as Partial<LifecycleTask>), adHoc: true })] }), undefined, 201);
    }),
    http.post(`${API_BASE_URL}/lifecycle/:id/complete`, async ({ request, params }) => {
      const body = await record(request, `/lifecycle/${params.id}/complete`);
      if (refuseComplete) return HttpResponse.json({ success: false, error: { message: refuseComplete } }, { status: 400 });
      const p = find(params.id);
      return ok(
        save({
          ...p,
          status: 'completed',
          completedAt: '2026-10-05T05:00:00.000Z',
          completedByName: 'Ann Admin',
          accountDisabled: p.kind === 'offboarding',
          tasks: p.tasks.map((t) => (t.status === 'pending' && body.skipRemaining ? { ...t, status: 'skipped', skipReason: 'Skipped when the process was completed' } : t)),
        })
      );
    }),
    http.post(`${API_BASE_URL}/lifecycle/:id/cancel`, async ({ request, params }) => {
      const body = await record(request, `/lifecycle/${params.id}/cancel`);
      const p = find(params.id);
      return ok(save({ ...p, status: 'cancelled', cancelledAt: '2026-10-05T05:00:00.000Z', cancelledReason: body.reason as string, tasks: p.tasks.map((t) => (t.status === 'pending' ? { ...t, status: 'skipped' } : t)) }));
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

function renderPage(url = '/people-ops/onboarding') {
  render(
    <Provider store={makeTestStore({ auth: adminAuth() })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/people-ops/onboarding" element={<><LifecycleProcessesPage key="on" kind="onboarding" /><LocationProbe /></>} />
          <Route path="/people-ops/offboarding" element={<><LifecycleProcessesPage key="off" kind="offboarding" /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

const drawers = () => [...document.querySelectorAll('.ant-drawer-open')] as HTMLElement[];
const processDrawer = () => drawers()[0];
const modal = () => [...document.querySelectorAll('.ant-modal')].at(-1) as HTMLElement;
const taskRow = (title: string) => within(processDrawer()).getByText(title).closest('tr') as HTMLElement;
const lastRequest = (path: string) => requests.filter((r) => r.path === path).at(-1);

/** Picks an option in a searchable select: types to narrow it, then clicks it in the open dropdown. */
async function choose(scope: HTMLElement, label: string, option: string) {
  const input = within(scope).getByLabelText(label);
  await userEvent.click(input);
  await userEvent.type(input, option.split(' ')[0]);
  const open = [...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')].at(-1) as HTMLElement;
  await userEvent.click(await within(open).findByTitle(option));
}

async function openTaskAction(title: string, action: string) {
  await userEvent.click(within(taskRow(title)).getByRole('button', { name: `Actions for ${title}` }));
  await userEvent.click(await screen.findByText(action));
}

describe('People ops: onboarding', () => {
  it('lists who is joining with progress, and opens one from the list', async () => {
    renderPage();
    const row = (await screen.findByText('Ivy Mehta')).closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('Mon, 12 Oct');
    expect(row).toHaveTextContent('1 of 3');
    expect(within(row).getByText('1 overdue')).toBeInTheDocument();

    await userEvent.click(row);
    await waitFor(() => expect(processDrawer()).toBeTruthy());
    expect(screen.getByTestId('location')).toHaveTextContent('/people-ops/onboarding?process=p1');
    expect(await within(processDrawer()).findByText("Ivy Mehta's onboarding")).toBeInTheDocument();
    expect(within(processDrawer()).getByText('Manager').closest('tr')).toHaveTextContent('Mia Shah');
    expect(within(processDrawer()).getByText('Buddy').closest('tr')).toHaveTextContent('Bob Rao');
    expect(taskRow('Create email and system accounts')).toHaveTextContent('Admins');
    expect(taskRow('Create email and system accounts')).toHaveTextContent('overdue');
    expect(taskRow('Assign a buddy')).toHaveTextContent('Mia Shah (manager)');
    expect(within(screen.getByTestId('process-progress')).getByText('1 done · 0 skipped · 2 pending · 1 overdue')).toBeInTheDocument();

    await userEvent.click(within(processDrawer()).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/people-ops\/onboarding$/));

    await userEvent.click(screen.getByText('Completed'));
    await waitFor(() => expect(lastRequest('/lifecycle')?.query).toMatchObject({ kind: 'onboarding', status: 'completed' }));
    expect(await screen.findByText('No completed onboarding yet')).toBeInTheDocument();
  });

  it('opens a process straight from a link (as notifications do)', async () => {
    renderPage('/people-ops/onboarding?process=p1');
    await waitFor(() => expect(processDrawer()).toBeTruthy());
    expect(await within(processDrawer()).findByText("Ivy Mehta's onboarding")).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('process=p1');
  });

  it('starts onboarding with the default template and a buddy, then opens it', async () => {
    renderPage();
    await screen.findByText('Ivy Mehta');
    await userEvent.click(screen.getByRole('button', { name: /Start onboarding/ }));
    // Only new joiners are offered, not everyone.
    await userEvent.click(within(modal()).getByLabelText('New joiner'));
    const joiners = [...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')].at(-1) as HTMLElement;
    await waitFor(() => expect([...joiners.querySelectorAll('.ant-select-item-option')].map((o) => o.getAttribute('title'))).toEqual(['Raj Patel']));
    await choose(modal(), 'New joiner', 'Raj Patel');
    expect(await within(modal()).findByTitle('Standard onboarding (default) · 2 tasks')).toBeInTheDocument();
    // Raj isn't offered as his own buddy.
    await userEvent.click(within(modal()).getByLabelText('Buddy (optional)'));
    const buddies = [...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')].at(-1) as HTMLElement;
    expect(within(buddies).queryByTitle('Raj Patel')).not.toBeInTheDocument();
    await choose(modal(), 'Buddy (optional)', 'Bob Rao');
    await userEvent.click(within(modal()).getByRole('button', { name: 'Start' }));

    await waitFor(() => expect(lastRequest('/lifecycle/onboarding')?.body).toEqual({ employeeId: 'u2', templateId: 't-on', buddyId: 'u8' }));
    expect(await screen.findByText('Onboarding started for Raj Patel')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('process=p-new'));
  });

  it('reassigns a task and moves its due date', async () => {
    renderPage('/people-ops/onboarding?process=p1');
    await waitFor(() => expect(processDrawer()).toBeTruthy());
    await within(processDrawer()).findByText('Upload ID and address proof');

    await openTaskAction('Upload ID and address proof', 'Reassign…');
    await choose(modal(), 'Who does it', 'Bob Rao');
    await userEvent.click(within(modal()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(lastRequest('/lifecycle/tasks/t3')?.body).toEqual({ assigneeId: 'u8' }));
    await waitFor(() => expect(taskRow('Upload ID and address proof')).toHaveTextContent('Bob Rao'));

    await openTaskAction('Upload ID and address proof', 'Change due date…');
    const due = within(modal()).getByLabelText('Due date');
    await userEvent.clear(due);
    await userEvent.type(due, '2026-10-14{enter}');
    await userEvent.click(within(modal()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(lastRequest('/lifecycle/tasks/t3')?.body).toEqual({ dueDate: '2026-10-14' }));
    await waitFor(() => expect(taskRow('Upload ID and address proof')).toHaveTextContent('Wed, 14 Oct'));
  });

  it('skips a task (with a reason) and adds one', async () => {
    renderPage('/people-ops/onboarding?process=p1');
    await waitFor(() => expect(processDrawer()).toBeTruthy());
    await within(processDrawer()).findByText('Create email and system accounts');

    await openTaskAction('Create email and system accounts', 'Skip…');
    await userEvent.click(within(modal()).getByRole('button', { name: 'Skip task' }));
    expect(within(modal()).getByText('Say why it’s being skipped')).toBeInTheDocument();
    await userEvent.click(within(modal()).getByLabelText('Why skip it?'));
    await userEvent.paste('She brings her own laptop');
    await userEvent.click(within(modal()).getByRole('button', { name: 'Skip task' }));
    await waitFor(() => expect(lastRequest('/lifecycle/tasks/t1/skip')?.body).toEqual({ reason: 'She brings her own laptop' }));
    await waitFor(() => expect(within(taskRow('Create email and system accounts')).getByText('Skipped')).toBeInTheDocument());

    await userEvent.click(within(processDrawer()).getByRole('button', { name: /Add task/ }));
    await userEvent.click(within(modal()).getByLabelText('Task'));
    await userEvent.paste('Week-one survey');
    await userEvent.click(within(modal()).getByLabelText('Type'));
    await userEvent.click(await screen.findByTitle('Form (questions)'));
    await userEvent.click(within(modal()).getByLabelText('Questions (one per line)'));
    await userEvent.paste('How was week one?\nAnything missing?');
    await userEvent.click(within(modal()).getByRole('button', { name: 'Add task' }));
    await waitFor(() =>
      expect(lastRequest('/lifecycle/p1/tasks')?.body).toEqual({
        title: 'Week-one survey',
        type: 'form',
        questions: ['How was week one?', 'Anything missing?'],
        instructions: '',
        link: null,
        assigneeId: null,
        dueDate: '2026-10-05',
      })
    );
    expect(await within(processDrawer()).findByText('Week-one survey')).toBeInTheDocument();
  });

  it('completes, skipping what is left; or cancels with a reason', async () => {
    renderPage('/people-ops/onboarding?process=p1');
    await waitFor(() => expect(processDrawer()).toBeTruthy());
    await within(processDrawer()).findByText("Ivy Mehta's onboarding");

    await userEvent.click(within(processDrawer()).getByRole('button', { name: /Cancel onboarding/ }));
    await userEvent.click(within(modal()).getByRole('button', { name: 'Cancel onboarding' }));
    expect(within(modal()).getByText('Say why it’s being cancelled')).toBeInTheDocument();
    await userEvent.click(within(modal()).getByRole('button', { name: 'Back' }));

    await userEvent.click(within(processDrawer()).getByRole('button', { name: /Complete/ }));
    expect(within(modal()).getByText('2 tasks are still pending. They will be skipped.')).toBeInTheDocument();
    await userEvent.click(within(modal()).getByRole('button', { name: 'Skip 2 and complete' }));
    await waitFor(() => expect(lastRequest('/lifecycle/p1/complete')?.body).toEqual({ skipRemaining: true }));
    expect(await screen.findByText("Completed Ivy Mehta's onboarding")).toBeInTheDocument();
    expect(within(processDrawer()).getByText('Completed', { selector: '.ant-tag' })).toBeInTheDocument();
    expect(within(processDrawer()).queryByRole('button', { name: /Add task/ })).not.toBeInTheDocument();
  });
});

describe('People ops: offboarding', () => {
  it('shows the reason and notes, warns that completing disables the account, and shows a refusal', async () => {
    refuseComplete = "Reassign Mia Shah's direct reports to another manager first";
    renderPage('/people-ops/offboarding?process=p5');
    await waitFor(() => expect(processDrawer()).toBeTruthy());
    expect(await within(processDrawer()).findByText("Mia Shah's offboarding")).toBeInTheDocument();
    expect(within(processDrawer()).getByText('Resignation')).toBeInTheDocument();
    expect(within(processDrawer()).getByText('Moving to Pune')).toBeInTheDocument();
    expect(within(processDrawer()).getByText("Mia Shah's last day has passed. Their account stays active until you complete the offboarding.")).toBeInTheDocument();

    await userEvent.click(within(processDrawer()).getByRole('button', { name: /Complete/ }));
    expect(within(modal()).getByText("This disables Mia Shah's account. They won't be able to log in.")).toBeInTheDocument();
    await userEvent.click(within(modal()).getByRole('button', { name: 'Complete' }));
    expect(await within(modal()).findByText("Reassign Mia Shah's direct reports to another manager first")).toBeInTheDocument();

    refuseComplete = null;
    await userEvent.click(within(modal()).getByRole('button', { name: 'Complete' }));
    expect(await screen.findByText("Completed Mia Shah's offboarding. Their account is disabled.")).toBeInTheDocument();
    expect(within(processDrawer()).getByText(/account disabled/)).toBeInTheDocument();
  });

  it("lets an admin read a finished exit interview's answers", async () => {
    renderPage('/people-ops/offboarding?process=p5');
    await waitFor(() => expect(processDrawer()).toBeTruthy());
    await userEvent.click(await within(processDrawer()).findByRole('button', { name: 'Exit interview' }));
    await waitFor(() => expect(drawers()).toHaveLength(2));
    const taskDrawer = drawers()[1];
    expect(within(taskDrawer).getByText("Mia Shah's offboarding")).toBeInTheDocument();
    expect(within(taskDrawer).getByText('Why are you leaving?')).toBeInTheDocument();
    expect(within(taskDrawer).getByText('Closer to family')).toBeInTheDocument();
  });

  it('says so when there is nobody to onboard', async () => {
    server.use(http.get(`${API_BASE_URL}/lifecycle/candidates`, () => ok([])));
    renderPage();
    await screen.findByText('Ivy Mehta');
    await userEvent.click(screen.getByRole('button', { name: /Start onboarding/ }));
    await userEvent.click(within(modal()).getByLabelText('New joiner'));
    expect(await screen.findByText(/Nobody to onboard\. New joiners \(joining soon, or in the last 30 days\)/)).toBeInTheDocument();
  });
});
