import type { Person } from './people';

export type LifecycleKind = 'onboarding' | 'offboarding';
export type AssigneeKind = 'employee' | 'manager' | 'buddy' | 'admin' | 'person';
export type ChecklistTaskType = 'task' | 'upload' | 'acknowledge' | 'form';
export type LifecycleTaskStatus = 'pending' | 'done' | 'skipped';
export type ProcessStatus = 'active' | 'completed' | 'cancelled';

export interface TaskFile {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
}

/** A task in a running onboarding/offboarding, as its assignee (or an ORG_ADMIN) sees it. */
export interface LifecycleTask {
  id: string;
  processId: string;
  /** Whose process it is. */
  employeeId: string;
  kind: LifecycleKind;
  order: number;
  title: string;
  instructions: string;
  type: ChecklistTaskType;
  questions: string[];
  /** An app path (/home?tab=welcome) or an http(s) URL. */
  link: string | null;
  assigneeKind: AssigneeKind;
  /** null = any ORG_ADMIN. */
  assigneeId: string | null;
  assigneeName: string | null;
  /** YYYY-MM-DD */
  dueDate: string;
  overdue: boolean;
  status: LifecycleTaskStatus;
  completedByName: string | null;
  completedAt: string | null;
  note: string;
  files: TaskFile[];
  /** Form answers: ORG_ADMINs only (null for everyone else). */
  answers: { question: string; text: string }[] | null;
  acknowledged: boolean;
  skipReason: string;
  adHoc: boolean;
}

export interface LifecycleProgress {
  total: number;
  done: number;
  skipped: number;
  pending: number;
  overdue: number;
}

/** My own running onboarding/offboarding: only the tasks that are mine to do. */
export interface MyLifecycle {
  id: string;
  kind: LifecycleKind;
  status: ProcessStatus;
  templateName: string;
  /** YYYY-MM-DD: my joining date, or my last working day. */
  anchorDate: string;
  employee: Person | null;
  manager: Person | null;
  buddy: Person | null;
  progress: LifecycleProgress;
  tasks: LifecycleTask[];
}

/** Tasks I do in someone else's process, grouped by that person. */
export interface AssignedGroup {
  processId: string;
  kind: LifecycleKind;
  anchorDate: string;
  employee: Person | null;
  tasks: LifecycleTask[];
}

export interface CompleteTaskPayload {
  note?: string;
  answers?: string[];
  acknowledged?: boolean;
}

// ---------------------------------------------------------------- ORG_ADMIN

export type OffboardingReason = 'resignation' | 'termination' | 'end_of_contract' | 'other';

/** A process as ORG_ADMIN sees it: with the reason, notes and why it was cancelled. */
export interface AdminProcess {
  id: string;
  kind: LifecycleKind;
  status: ProcessStatus;
  templateName: string;
  anchorDate: string;
  employee: Person | null;
  manager: Person | null;
  buddy: Person | null;
  reason: OffboardingReason | null;
  adminNotes: string | null;
  progress: LifecycleProgress;
  startedAt: string;
  startedByName: string | null;
  completedAt: string | null;
  completedByName: string | null;
  accountDisabled: boolean;
  cancelledAt: string | null;
  cancelledReason: string | null;
}

export interface ProcessDetail extends AdminProcess {
  tasks: LifecycleTask[];
}

export interface StartOnboardingPayload {
  employeeId: string;
  templateId: string;
  buddyId?: string | null;
}

export interface StartOffboardingPayload {
  employeeId: string;
  templateId: string;
  lastWorkingDay: string;
  reason: OffboardingReason;
  adminNotes: string;
}

export interface AddTaskPayload {
  title: string;
  instructions: string;
  type: ChecklistTaskType;
  questions: string[];
  link: string | null;
  /** A person, or null for the admins. */
  assigneeId: string | null;
  dueDate: string;
}

export interface UpdateTaskPayload {
  assigneeId?: string | null;
  dueDate?: string;
}

export interface TemplateTask {
  /** Stable within the template; omit for a new task. */
  key?: string;
  title: string;
  instructions: string;
  assignee: { kind: AssigneeKind; userId: string | null; name?: string | null };
  /** Days from the joining date or last working day; negative = before. */
  dueOffsetDays: number;
  type: ChecklistTaskType;
  questions: string[];
  link: string | null;
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  kind: LifecycleKind;
  isDefault: boolean;
  tasks: (TemplateTask & { key: string })[];
  updatedAt: string;
}

export interface TemplatePayload {
  name: string;
  kind?: LifecycleKind;
  tasks: TemplateTask[];
}
