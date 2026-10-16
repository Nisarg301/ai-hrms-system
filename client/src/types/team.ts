import type { HalfDay } from './leave';
import type { Person } from './people';

export interface TeamMember extends Person {
  leaveToday: { halfDay: HalfDay | null } | null;
  /** Working dates this week (Mon–Sun) on approved leave. */
  leaveThisWeek: string[];
}

export interface MyTeam {
  today: string;
  week: { from: string; to: string };
  manager: TeamMember | null;
  peers: TeamMember[];
  directReports: TeamMember[];
}
