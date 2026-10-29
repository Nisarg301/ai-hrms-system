import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { dayView } from '../../test/attendanceFixtures';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import { activeSubscription } from '../../test/fixtures';
import type { AuthState } from '../../store/auth/authSlice';
import type { Holiday } from '../../types/holiday';
import type { LeaveRequestRow } from '../../types/leave';
import type { Person } from '../../types/people';
import type { MyTeam, TeamMember } from '../../types/team';
import MePage from './MePage';

function person(id: string, name: string, extra: Partial<Person> = {}): Person {
  return { id, name, jobTitle: null, departmentName: null, avatarUrl: null, role: 'ORG_USER', reportsTo: null, joiningDate: '2025-01-01', ...extra };
}

function member(id: string, name: string, extra: Partial<TeamMember> = {}): TeamMember {
  return { ...person(id, name), leaveToday: null, leaveThisWeek: [], ...extra };
}

function request(id: string, extra: Partial<LeaveRequestRow> = {}): LeaveRequestRow {
  return {
    id,
    employeeId: 'u1',
    employeeName: 'Ivy Mehta',
    leaveTypeId: 't1',
    leaveTypeName: 'Paid Leave',
    leaveTypeCode: 'PL',
    isPaid: true,
    startDate: '2026-10-20',
    endDate: '2026-10-21',
    halfDay: null,
    days: 2,
    reason: '',
    status: 'pending',
    decidedByName: null,
    decidedAt: null,
    decisionNote: '',
    recordedByName: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    canCancel: true,
    ...extra,
  };
}

let myDob: string | null;
let dobPuts: unknown[];
let db: { requests: LeaveRequestRow[]; team: MyTeam; holidays: Record<string, Holiday[]>; cancelled: string[]; balanceCalls: number };

beforeEach(() => {
  myDob = null;
  dobPuts = [];
  db = {
    requests: [
      request('r1'),
      request('r2', { startDate: '2026-09-01', endDate: '2026-09-01', days: 1, status: 'approved', canCancel: false, decidedByName: 'Ann Admin', recordedByName: 'Ann Admin' }),
      request('r3', { startDate: '2026-08-10', endDate: '2026-08-10', halfDay: 'first', days: 0.5, status: 'rejected', canCancel: false, decisionNote: 'Release week' }),
    ],
    team: {
      today: '2026-10-05',
      week: { from: '2026-10-05', to: '2026-10-11' },
      manager: member('m1', 'Maya Shah', { jobTitle: 'Engineering Manager' }),
      peers: [member('p1', 'Raj Patel', { leaveToday: { halfDay: 'second' } }), member('p2', 'Omar Old', { leaveThisWeek: ['2026-10-08'] })],
      directReports: [member('d1', 'Neha New')],
    },
    holidays: {},
    cancelled: [],
    balanceCalls: 0,
  };
  const ok = (data: unknown) => HttpResponse.json({ success: true, data });
  server.use(
    http.get(`${API_BASE_URL}/leave/balances`, () => {
      db.balanceCalls += 1;
      return ok([{ leaveTypeId: 't1', name: 'Paid Leave', code: 'PL', isPaid: true, allowHalfDay: true, yearlyQuota: 12, approved: 1, pending: 2, available: 9 }]);
    }),
    http.get(`${API_BASE_URL}/leave/requests/mine`, () => ok(db.requests)),
    http.post(`${API_BASE_URL}/leave/requests/:id/cancel`, ({ params }) => {
      db.cancelled.push(params.id as string);
      const row = db.requests.find((r) => r.id === params.id)!;
      Object.assign(row, { status: 'cancelled', canCancel: false });
      return ok(row);
    }),
    http.get(`${API_BASE_URL}/me/team`, () => ok(db.team)),
    http.get(`${API_BASE_URL}/me/introduction`, () => ok({ about: '', hobbies: '', lovesAboutJob: '' })),
    http.get(`${API_BASE_URL}/me/profile-details`, () => ok({ dateOfBirth: myDob })),
    http.put(`${API_BASE_URL}/me/profile-details`, async ({ request: req }) => {
      const body = (await req.json()) as { dateOfBirth: string | null };
      dobPuts.push(body);
      myDob = body.dateOfBirth;
      return ok({ dateOfBirth: myDob });
    }),
    http.get(`${API_BASE_URL}/people`, () =>
      ok([
        person('u1', 'Ivy Mehta', { jobTitle: 'Frontend Engineer', departmentName: 'Engineering', reportsTo: 'm1', joiningDate: '2026-09-15' }),
        person('m1', 'Maya Shah'),
      ])
    ),
    http.get(`${API_BASE_URL}/holidays`, ({ request: req }) => ok(db.holidays[new URL(req.url).searchParams.get('year')!] ?? []))
  );
});

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderMe(url: string) {
  const auth: AuthState = {
    user: { id: 'u1', name: 'Ivy Mehta', email: 'ivy@acme.com', role: 'ORG_USER', organizationId: 'o1', roleId: null, mustChangePassword: false, permissions: { scope: 'none' }, subscription: activeSubscription('basic') },
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
            path="/me/:tab?"
            element={
              <>
                <MePage />
                <LocationProbe />
              </>
            }
          />
          <Route path="/profile" element={<div>Profile Page</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

describe('MePage tabs', () => {
  it('opens Leave by default and keeps the tab in the URL', async () => {
    renderMe('/me');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/me/leave'));
    await userEvent.click(screen.getByRole('tab', { name: /team/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('/me/team');
    expect(await screen.findByText('Maya Shah')).toBeInTheDocument();
  });

  it('opens Attendance from its URL', async () => {
    server.use(
      http.get(`${API_BASE_URL}/attendance/me`, () =>
        HttpResponse.json({ success: true, data: { month: '2026-10', days: [dayView('2026-10-01', { status: 'present' })], totals: { present: 1, halfDay: 0, absent: 0, late: 0, onLeave: 0, averageMinutes: 480 } } })
      ),
      http.get(`${API_BASE_URL}/attendance/requests/mine`, () => HttpResponse.json({ success: true, data: [] }))
    );
    renderMe('/me/attendance');
    expect(await screen.findByTestId('month-grid')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /attendance/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('sends an unknown tab to Leave', async () => {
    renderMe('/me/nope');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/me/leave'));
  });
});

describe('My leave', () => {
  it('shows balances and my requests with their status', async () => {
    renderMe('/me/leave');
    const card = await screen.findByTestId('balance-card');
    expect(within(card).getByText('9')).toBeInTheDocument();
    expect(within(card).getByText('1 taken · 2 pending')).toBeInTheDocument();

    expect(await screen.findByText('20 – 21 Oct 2026')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('10 Aug 2026 (first half)')).toBeInTheDocument();
    // Leave an admin recorded for me says so; my own requests don't.
    expect(screen.getAllByText('Recorded by Ann Admin')).toHaveLength(1);
    expect(screen.getByText('Rejected')).toBeInTheDocument();
  });

  it('offers Cancel only where allowed, and cancels after confirming', async () => {
    renderMe('/me/leave');
    await screen.findByText('20 – 21 Oct 2026');
    const cancels = screen.getAllByRole('button', { name: /^cancel leave on/i });
    expect(cancels).toHaveLength(1);
    expect(cancels[0]).toHaveAccessibleName('Cancel leave on 20 – 21 Oct 2026');

    const before = db.balanceCalls;
    await userEvent.click(cancels[0]);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel leave' }));

    await waitFor(() => expect(db.cancelled).toEqual(['r1']));
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^cancel leave on/i })).not.toBeInTheDocument();
    await waitFor(() => expect(db.balanceCalls).toBeGreaterThan(before));
  });

  it('opens the Apply leave drawer', async () => {
    renderMe('/me/leave');
    await userEvent.click(await screen.findByRole('button', { name: /apply leave/i }));
    expect(await screen.findByText('Apply for leave')).toBeInTheDocument();
  });
});

describe('Profile', () => {
  it('shows my job details, manager and joining date', async () => {
    renderMe('/me/profile');
    expect(await screen.findByText('Engineering')).toBeInTheDocument();
    expect(screen.getAllByText('Frontend Engineer').length).toBeGreaterThan(0);
    expect(screen.getByText('ivy@acme.com')).toBeInTheDocument();
    expect(screen.getByText('Maya Shah')).toBeInTheDocument();
    expect(screen.getByText('15 Sep 2026')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /introduce yourself/i })).toBeInTheDocument();
  });
});

describe('Profile: date of birth', () => {
  it('lets me add my date of birth and remove it again', async () => {
    renderMe('/me/profile');
    expect(await screen.findByText('Not set')).toBeInTheDocument();
    expect(screen.getByText('Colleagues see only the day and month, to wish you on your birthday.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add date of birth' }));
    await userEvent.type(screen.getByLabelText('Date of birth'), '1995-03-12{enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('12 Mar 1995')).toBeInTheDocument();
    expect(dobPuts).toEqual([{ dateOfBirth: '1995-03-12' }]);

    await userEvent.click(screen.getByRole('button', { name: 'Change date of birth' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Not set')).toBeInTheDocument();
    expect(dobPuts.at(-1)).toEqual({ dateOfBirth: null });
  });
});

describe('Team', () => {
  it('shows my manager, teammates and reports with their availability', async () => {
    renderMe('/me/team');
    await screen.findByText('Maya Shah');
    const cards = screen.getAllByTestId('team-member');
    const status = (name: string) => cards.find((c) => within(c).queryByText(name))!;
    expect(within(status('Raj Patel')).getByText('On leave today (second half)')).toBeInTheDocument();
    expect(within(status('Omar Old')).getByText('On leave Thu, 8 Oct')).toBeInTheDocument();
    expect(within(status('Neha New')).getByText('Available')).toBeInTheDocument();
    expect(screen.getByText('Teammates · 2')).toBeInTheDocument();
    expect(screen.getByText('Reporting to me · 1')).toBeInTheDocument();
  });

  it('explains when I have no team yet', async () => {
    db.team = { ...db.team, manager: null, peers: [], directReports: [] };
    renderMe('/me/team');
    expect(await screen.findByText("You're not in a team yet. Ask your admin to set your manager.")).toBeInTheDocument();
  });
});

describe('Holidays', () => {
  it('groups by month, dims past dates, and switches year', async () => {
    const year = dayjs().year();
    const past = dayjs().subtract(40, 'day');
    const future = dayjs().add(40, 'day');
    db.holidays[String(year)] = [
      { id: 'h2', name: 'Future Fest', date: future.format('YYYY-MM-DD'), description: 'Office closed' },
      { id: 'h1', name: 'Past Day', date: past.format('YYYY-MM-DD'), description: '' },
    ].filter((h) => h.date.startsWith(String(year)));
    db.holidays[String(year + 1)] = [{ id: 'h9', name: 'New Year', date: `${year + 1}-01-01`, description: '' }];

    renderMe('/me/holidays');
    for (const h of db.holidays[String(year)]) {
      const row = (await screen.findByText(h.name)).closest('[data-testid="holiday-row"]')!;
      expect(row).toHaveAttribute('data-past', String(h.id === 'h1'));
      expect(screen.getByRole('region', { name: dayjs(h.date).format('MMMM YYYY') })).toContainElement(row as HTMLElement);
    }

    await userEvent.click(screen.getByRole('combobox', { name: 'Year' }));
    await userEvent.click(await screen.findByTitle(String(year + 1)));
    expect(await screen.findByText('New Year')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: `January ${year + 1}` })).toBeInTheDocument();
  });

  it('says when no holidays have been added', async () => {
    renderMe('/me/holidays');
    expect(await screen.findByText(`No holidays have been added for ${dayjs().year()} yet.`)).toBeInTheDocument();
  });

  it('shows the year in the URL, as the Holidays assistant sets it', async () => {
    const next = dayjs().year() + 1;
    db.holidays[String(next)] = [{ id: 'h9', name: 'New Year', date: `${next}-01-01`, description: '' }];
    renderMe(`/me/holidays?year=${next}`);
    expect(await screen.findByText('New Year')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Year' }).closest('.ant-select')).toHaveTextContent(String(next));
  });
});
