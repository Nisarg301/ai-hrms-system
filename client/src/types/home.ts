import type { Announcement } from './announcement';
import type { Holiday } from './holiday';
import type { HalfDay, LeaveBalance } from './leave';
import type { Person } from './people';

export interface OnLeaveToday {
  employeeId: string;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  leaveTypeName: string;
  halfDay: HalfDay | null;
}

export interface ModuleCounts {
  employees: number | null;
  documents: number | null;
  projects: number | null;
  tasks: number | null;
}

export interface Celebration {
  person: Person;
  kind: 'birthday' | 'anniversary';
  /** The date it falls on this time round (YYYY-MM-DD); never a birth year. */
  date: string;
  /** Anniversaries only: whole years since joining. */
  years: number | null;
}

export interface HomeSummary {
  /** YYYY-MM-DD in the organization's timezone. */
  today: string;
  week: { from: string; to: string };
  upcomingHolidays: Holiday[];
  onLeaveToday: OnLeaveToday[];
  teamOnLeave: {
    /** People in my team (manager, peers, reports); 0 = no team yet. */
    size: number;
    today: (Person & { halfDay: HalfDay | null })[];
    thisWeek: { person: Person; dates: string[] }[];
  };
  announcements: Announcement[];
  balances: LeaveBalance[];
  /** null without dashboard read. */
  moduleCounts: ModuleCounts | null;
  /** ORG_ADMIN only. */
  pendingApprovals: number | null;
  /** Today's, then the next 7 days'. */
  celebrations: { today: Celebration[]; upcoming: Celebration[] };
}
