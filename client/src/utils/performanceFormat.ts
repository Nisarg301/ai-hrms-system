import type { CycleStatus, Goal, GoalStatus, PartStatus } from '../types/performance';

export const GOAL_STATUS_META: Record<GoalStatus, { label: string; color: string }> = {
  on_track: { label: 'On track', color: 'green' },
  at_risk: { label: 'At risk', color: 'orange' },
  behind: { label: 'Behind', color: 'red' },
  completed: { label: 'Completed', color: 'blue' },
  cancelled: { label: 'Cancelled', color: 'default' },
};

export const GOAL_STATUS_OPTIONS = (Object.keys(GOAL_STATUS_META) as GoalStatus[]).map((s) => ({ value: s, label: GOAL_STATUS_META[s].label }));

/** Goals that need a manager's attention. */
export const needsAttention = (g: Pick<Goal, 'status' | 'overdue'>) => g.status === 'at_risk' || g.status === 'behind' || g.overdue;

/** The weights of running and completed goals (cancelled ones don't count); null when none has a weight. */
export function totalWeight(goals: Pick<Goal, 'weight' | 'status'>[]): number | null {
  const weighted = goals.filter((g) => g.weight !== null && g.status !== 'cancelled');
  return weighted.length ? weighted.reduce((sum, g) => sum + (g.weight ?? 0), 0) : null;
}

/** The fixed 1–5 scale (Default 6). */
export const RATING_LABELS: Record<number, string> = {
  1: 'Needs improvement',
  2: 'Below expectations',
  3: 'Meets expectations',
  4: 'Exceeds expectations',
  5: 'Outstanding',
};

export const PART_STATUS_META: Record<PartStatus, { label: string; color: string }> = {
  not_started: { label: 'Not started', color: 'default' },
  draft: { label: 'In progress', color: 'gold' },
  submitted: { label: 'Submitted', color: 'green' },
};

/** "Write self review" / "Continue" / "View": what opening a review lets me do. */
export function reviewAction(status: PartStatus, open: boolean): string {
  if (!open || status === 'submitted') return 'View';
  return status === 'draft' ? 'Continue' : 'Write';
}

/** A running goal with no check-in (or creation) in the last 30 days. */
export function needsCheckIn(goal: Pick<Goal, 'status' | 'lastCheckInAt' | 'createdAt'>, today: string): boolean {
  if (goal.status === 'completed' || goal.status === 'cancelled') return false;
  const last = (goal.lastCheckInAt ?? goal.createdAt).slice(0, 10);
  const monthAgo = new Date(`${today}T00:00:00Z`);
  monthAgo.setUTCDate(monthAgo.getUTCDate() - 30);
  return last < monthAgo.toISOString().slice(0, 10);
}

/** Reviews can still be written in a launched or released cycle. */
export const isOpenCycle = (status: CycleStatus) => status === 'launched' || status === 'released';
