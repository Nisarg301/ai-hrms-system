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
import type { CycleSummary, PartStatus, ReviewDetail, ReviewPartView } from '../../../types/performance';
import MePage from '../MePage';

const IVY = lcPerson('u1', 'Ivy Mehta', { reportsTo: 'u9' });
const MIA = lcPerson('u9', 'Mia Shah');
const RAJ = lcPerson('r1', 'Raj Patel', { reportsTo: 'u1' });
const ZOE = lcPerson('z1', 'Zoe Khan', { reportsTo: 'u1' });
const QUESTIONS = [
  { id: 'q1', text: 'What did you achieve this period?' },
  { id: 'q2', text: 'What will you focus on next?' },
];
const H2: CycleSummary = { id: 'c2', name: 'H2 2026', periodFrom: '2026-07-01', periodTo: '2026-12-31', selfDueDate: '2026-10-20', managerDueDate: '2026-10-31', status: 'launched' };
const H1: CycleSummary = { id: 'c1', name: 'H1 2026', periodFrom: '2026-01-01', periodTo: '2026-06-30', selfDueDate: '2026-07-10', managerDueDate: '2026-07-20', status: 'closed' };

function part(status: PartStatus, texts: string[] = [], rating: number | null = null): ReviewPartView {
  return {
    status,
    answers: QUESTIONS.map((q, i) => ({ questionId: q.id, question: q.text, text: texts[i] ?? '' })),
    rating,
    savedAt: status === 'not_started' ? null : '2026-10-04T05:00:00.000Z',
    submittedAt: status === 'submitted' ? '2026-10-04T05:00:00.000Z' : null,
  };
}

function review(id: string, extra: Partial<ReviewDetail>): ReviewDetail {
  return {
    id,
    cycle: { ...H2, questions: QUESTIONS },
    role: 'employee',
    employee: IVY,
    reviewer: MIA,
    selfStatus: 'not_started',
    managerStatus: null,
    self: part('not_started'),
    manager: null,
    released: false,
    releasedAt: null,
    goals: [{ goalId: 'g1', title: 'Launch onboarding', progress: 40, status: 'at_risk', weight: 60, dueDate: '2026-12-31' }],
    goalsAsOf: null,
    canWriteSelf: true,
    canWriteManager: false,
    ...extra,
  };
}

let reviews: Record<string, ReviewDetail>;
let writes: { path: string; body: unknown }[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 5, 10, 0));
  writes = [];
  reviews = {
    r1: review('r1', {}),
    r2: review('r2', {
      cycle: { ...H1, questions: QUESTIONS },
      selfStatus: 'submitted',
      self: part('submitted', ['Shipped attendance', 'Reviews'], 4),
      managerStatus: 'submitted',
      manager: part('submitted', ['Great half', 'Mentoring'], 4),
      released: true,
      releasedAt: '2026-07-25T05:00:00.000Z',
      goalsAsOf: '2026-07-10T05:00:00.000Z',
      canWriteSelf: false,
    }),
    r3: review('r3', {
      role: 'reviewer',
      employee: RAJ,
      reviewer: IVY,
      selfStatus: 'submitted',
      self: part('submitted', ['Closed 3 deals', 'Bigger accounts'], 3),
      managerStatus: 'not_started',
      manager: part('not_started'),
      canWriteSelf: false,
      canWriteManager: true,
    }),
    r4: review('r4', { role: 'reviewer', employee: ZOE, reviewer: IVY, selfStatus: 'draft', self: null, managerStatus: 'not_started', manager: part('not_started'), canWriteSelf: false, canWriteManager: true }),
  };
  const ok = (data: unknown) => HttpResponse.json({ success: true, data });
  server.use(
    http.get(`${API_BASE_URL}/people`, () => ok([IVY, MIA, RAJ, ZOE])),
    http.get(`${API_BASE_URL}/goals/mine`, () => ok([])),
    http.get(`${API_BASE_URL}/goals/team`, () => ok([])),
    http.get(`${API_BASE_URL}/reviews/mine`, () =>
      ok(
        ['r1', 'r2'].map((id) => {
          const r = reviews[id];
          return { id, cycle: r.cycle, reviewer: r.reviewer, selfStatus: r.selfStatus, released: r.released, managerRating: r.released ? r.manager!.rating : null };
        })
      )
    ),
    http.get(`${API_BASE_URL}/reviews/to-write`, () =>
      ok(['r3', 'r4'].map((id) => ({ id, cycle: reviews[id].cycle, employee: reviews[id].employee, selfStatus: reviews[id].selfStatus, managerStatus: reviews[id].managerStatus, released: false })))
    ),
    http.get(`${API_BASE_URL}/reviews/:id`, ({ params }) => ok(reviews[params.id as string])),
    ...(['self', 'manager'] as const).flatMap((p) => [
      http.put(`${API_BASE_URL}/reviews/:id/${p}`, async ({ params, request }) => {
        const body = (await request.json()) as { answers: { text: string }[]; rating: number | null };
        writes.push({ path: `/reviews/${params.id}/${p}`, body });
        const r = reviews[params.id as string];
        Object.assign(r, { [p]: part('draft', body.answers.map((a) => a.text), body.rating), [`${p}Status`]: 'draft' });
        return ok(r);
      }),
      http.post(`${API_BASE_URL}/reviews/:id/${p}/submit`, async ({ params, request }) => {
        const body = (await request.json()) as { answers: { text: string }[]; rating: number | null };
        writes.push({ path: `/reviews/${params.id}/${p}/submit`, body });
        const r = reviews[params.id as string];
        Object.assign(r, {
          [p]: part('submitted', body.answers.map((a) => a.text), body.rating),
          [`${p}Status`]: 'submitted',
          canWriteSelf: false,
          canWriteManager: false,
          goalsAsOf: '2026-10-05T05:00:00.000Z',
        });
        return ok(r);
      }),
    ])
  );
});
afterEach(() => {
  vi.useRealTimers();
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderPage(url: string) {
  render(
    <Provider store={makeTestStore({ auth: memberAuth('professional') })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/me/:tab" element={<><MePage /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

const drawer = () => document.querySelector('.ant-drawer-open') as HTMLElement;
const reviewCard = (cycle: string) => screen.getByText(cycle).closest('[data-testid="my-review"]') as HTMLElement;

/** antd's radio buttons hide the input; the visible button is its label. */
async function rate(label: string) {
  await userEvent.click(within(drawer()).getByRole('radio', { name: label }).closest('label') as HTMLElement);
}

async function answer(question: string, text: string) {
  await userEvent.click(within(drawer()).getByLabelText(question));
  await userEvent.paste(text);
}

describe('My reviews', () => {
  it('lists my reviews, then writes my self review: a draft first, then submitted', async () => {
    renderPage('/me/performance?section=reviews');
    await screen.findByText('H2 2026');
    expect(reviewCard('H2 2026')).toHaveTextContent('Self review: Not started');
    expect(reviewCard('H2 2026')).toHaveTextContent('Manager’s review not released yet');
    expect(reviewCard('H1 2026')).toHaveTextContent('Manager’s rating: 4 · Exceeds expectations');

    await userEvent.click(screen.getByRole('button', { name: 'Write self review: H2 2026' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('review=r1'));
    await waitFor(() => expect(drawer()).toBeTruthy());
    expect(await within(drawer()).findByText('Your H2 2026 review')).toBeInTheDocument();
    expect(within(within(drawer()).getByTestId('review-goals')).getByText('Launch onboarding')).toBeInTheDocument();
    expect(within(drawer()).getByText('Your manager’s review will show here once your admin releases the results.')).toBeInTheDocument();

    await answer('What did you achieve this period?', 'Shipped onboarding');
    await userEvent.click(within(drawer()).getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(writes.at(-1)).toEqual({ path: '/reviews/r1/self', body: { answers: [{ questionId: 'q1', text: 'Shipped onboarding' }, { questionId: 'q2', text: '' }], rating: null } })
    );
    await waitFor(() => expect(reviewCard('H2 2026')).toHaveTextContent('Self review: In progress'));

    // Not complete: says what's missing, sends nothing.
    await userEvent.click(within(drawer()).getByRole('button', { name: 'Submit' }));
    expect(within(drawer()).getByText('Answer every question (1 left). Choose a rating from 1 to 5')).toBeInTheDocument();
    expect(writes).toHaveLength(1);

    await answer('What will you focus on next?', 'Performance reviews');
    await rate('4: Exceeds expectations');
    expect(within(drawer()).getByText('4 · Exceeds expectations')).toBeInTheDocument();
    await userEvent.click(within(drawer()).getByRole('button', { name: 'Submit' }));
    const confirm = (await screen.findByText('Submit your self review?', { selector: '.ant-modal-confirm-title' })).closest('.ant-modal') as HTMLElement;
    await userEvent.click(within(confirm).getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(writes.at(-1)?.path).toBe('/reviews/r1/self/submit'));
    expect(writes.at(-1)?.body).toEqual({ answers: [{ questionId: 'q1', text: 'Shipped onboarding' }, { questionId: 'q2', text: 'Performance reviews' }], rating: 4 });
    expect(await within(drawer()).findByTestId('self-part')).toHaveTextContent('Performance reviews');
    expect(within(drawer()).queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
    await waitFor(() => expect(reviewCard('H2 2026')).toHaveTextContent('Self review: Submitted'));
  });

  it('opens a released review straight from a link, with my manager’s review next to mine', async () => {
    renderPage('/me/performance?review=r2');
    await waitFor(() => expect(drawer()).toBeTruthy());
    expect(await within(drawer()).findByText('Your H1 2026 review')).toBeInTheDocument();
    expect(within(drawer()).getByText('Released')).toBeInTheDocument();
    expect(within(drawer()).getByTestId('self-part')).toHaveTextContent('Shipped attendance');
    expect(within(drawer()).getByTestId('manager-part')).toHaveTextContent('Great half');
    expect(within(drawer()).getByTestId('manager-part')).toHaveTextContent('4 · Exceeds expectations');
    expect(within(drawer()).getByText(/as of 10 Jul/)).toBeInTheDocument();

    await userEvent.click(within(drawer()).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('review='));
  });
});

describe('Reviews to write', () => {
  it("writes a manager review with the employee's submitted self review alongside", async () => {
    renderPage('/me/performance?section=to-write');
    const raj = (await screen.findByText('Raj Patel')).closest('[data-testid="review-to-write"]') as HTMLElement;
    expect(screen.getByRole('tab', { name: 'Reviews to write (2)' })).toBeInTheDocument();
    expect(raj).toHaveTextContent('Their self review: Submitted');
    expect(raj).toHaveTextContent('Your review: Not started');

    await userEvent.click(within(raj).getByRole('button', { name: 'Write review: Raj Patel' }));
    await waitFor(() => expect(drawer()).toBeTruthy());
    expect(await within(drawer()).findByText("Raj Patel's H2 2026 review")).toBeInTheDocument();
    expect(within(drawer()).getByTestId('self-part')).toHaveTextContent('Closed 3 deals');
    expect(within(drawer()).getByTestId('self-part')).toHaveTextContent('3 · Meets expectations');

    await answer('What did you achieve this period?', 'Strong quarter');
    await answer('What will you focus on next?', 'Enterprise deals');
    await rate('4: Exceeds expectations');
    await userEvent.click(within(drawer()).getByRole('button', { name: 'Submit' }));
    const confirm = (await screen.findByText('Submit your review of Raj?', { selector: '.ant-modal-confirm-title' })).closest('.ant-modal') as HTMLElement;
    await userEvent.click(within(confirm).getByRole('button', { name: 'Submit' }));
    await waitFor(() =>
      expect(writes.at(-1)).toEqual({
        path: '/reviews/r3/manager/submit',
        body: { answers: [{ questionId: 'q1', text: 'Strong quarter' }, { questionId: 'q2', text: 'Enterprise deals' }], rating: 4 },
      })
    );
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Reviews to write (1)' })).toBeInTheDocument());
  });

  it('says when the employee has not submitted their self review yet', async () => {
    renderPage('/me/performance?review=r4');
    await waitFor(() => expect(drawer()).toBeTruthy());
    expect(await within(drawer()).findByText('Zoe hasn’t submitted a self review yet (in progress).')).toBeInTheDocument();
    expect(within(drawer()).getByRole('button', { name: 'Save draft' })).toBeInTheDocument();
  });
});
