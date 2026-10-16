import type { Person } from './people';

export type GoalStatus = 'on_track' | 'at_risk' | 'behind' | 'completed' | 'cancelled';

export interface Goal {
  id: string;
  ownerId: string;
  owner: Person | null;
  title: string;
  description: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  dueDate: string;
  /** Informational percentage; null = none. */
  weight: number | null;
  /** 0–100 */
  progress: number;
  status: GoalStatus;
  /** Past its due date and still running. */
  overdue: boolean;
  lastCheckInAt: string | null;
  checkInCount: number;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoalCheckIn {
  id: string;
  authorName: string;
  progress: number;
  status: GoalStatus;
  previousProgress: number;
  previousStatus: GoalStatus;
  comment: string;
  createdAt: string;
}

/** How I relate to a goal: it's mine, I'm the owner's manager, or I'm an admin. */
export type GoalRelation = 'owner' | 'manager' | 'admin';

export interface GoalDetail extends Goal {
  relation: GoalRelation;
  canDelete: boolean;
  /** Newest first. */
  checkIns: GoalCheckIn[];
}

export interface GoalPayload {
  title: string;
  description: string;
  startDate: string;
  dueDate: string;
  weight: number | null;
  /** For a direct report (manager) or anyone (admin). */
  ownerId?: string;
}

export interface CheckInPayload {
  progress: number;
  status: GoalStatus;
  comment: string;
}

// ---------------------------------------------------------------- reviews

export type CycleStatus = 'draft' | 'launched' | 'released' | 'closed';
export type PartStatus = 'not_started' | 'draft' | 'submitted';
export type ReviewPartName = 'self' | 'manager';

export interface CycleSummary {
  id: string;
  name: string;
  periodFrom: string;
  periodTo: string;
  selfDueDate: string;
  managerDueDate: string;
  status: CycleStatus;
}

/** One of my own reviews, in the list. The manager's rating shows once released. */
export interface MyReviewRow {
  id: string;
  cycle: CycleSummary;
  reviewer: Person | null;
  selfStatus: PartStatus;
  released: boolean;
  managerRating: number | null;
}

/** A review I'm to write the manager part of. */
export interface ReviewToWriteRow {
  id: string;
  cycle: CycleSummary;
  employee: Person | null;
  selfStatus: PartStatus;
  managerStatus: PartStatus;
  released: boolean;
}

export interface ReviewAnswer {
  questionId: string;
  question: string;
  text: string;
}

export interface ReviewPartView {
  status: PartStatus;
  answers: ReviewAnswer[];
  rating: number | null;
  savedAt: string | null;
  submittedAt: string | null;
}

export interface GoalSnapshot {
  goalId: string;
  title: string;
  progress: number;
  status: GoalStatus;
  weight: number | null;
  dueDate: string;
}

/**
 * A review as I may see it: the employee sees the manager part only once released; the
 * reviewer (and admins) see the self part once submitted.
 */
export interface ReviewDetail {
  id: string;
  cycle: CycleSummary & { questions: { id: string; text: string }[] };
  role: 'employee' | 'reviewer' | 'admin';
  employee: Person | null;
  /** null = the admins write it. */
  reviewer: Person | null;
  selfStatus: PartStatus;
  /** null while hidden from the employee. */
  managerStatus: PartStatus | null;
  self: ReviewPartView | null;
  manager: ReviewPartView | null;
  released: boolean;
  releasedAt: string | null;
  goals: GoalSnapshot[];
  /** When the goals were saved with a submitted part; null = live. */
  goalsAsOf: string | null;
  canWriteSelf: boolean;
  canWriteManager: boolean;
}

export interface ReviewPartPayload {
  answers: { questionId: string; text: string }[];
  rating: number | null;
}
