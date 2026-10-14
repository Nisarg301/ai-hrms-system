import type { AssignedGroup, LifecycleTask, MyLifecycle } from '../types/lifecycle';
import type { Person } from '../types/people';

export function lcPerson(id: string, name: string, extra: Partial<Person> = {}): Person {
  return { id, name, jobTitle: null, departmentName: null, avatarUrl: null, role: 'ORG_USER', reportsTo: null, joiningDate: '2025-01-01', ...extra };
}

export function lcTask(id: string, extra: Partial<LifecycleTask> = {}): LifecycleTask {
  return {
    id,
    processId: 'p1',
    employeeId: 'u1',
    kind: 'onboarding',
    order: 0,
    title: `Task ${id}`,
    instructions: '',
    type: 'task',
    questions: [],
    link: null,
    assigneeKind: 'employee',
    assigneeId: 'u1',
    assigneeName: 'Ivy Mehta',
    dueDate: '2026-10-12',
    overdue: false,
    status: 'pending',
    completedByName: null,
    completedAt: null,
    note: '',
    files: [],
    answers: null,
    acknowledged: false,
    skipReason: '',
    adHoc: false,
    ...extra,
  };
}

export function myProcess(extra: Partial<MyLifecycle> = {}): MyLifecycle {
  return {
    id: 'p1',
    kind: 'onboarding',
    status: 'active',
    templateName: 'Standard onboarding',
    anchorDate: '2026-10-12',
    employee: lcPerson('u1', 'Ivy Mehta'),
    manager: lcPerson('u9', 'Mia Shah'),
    buddy: lcPerson('u8', 'Bob Rao'),
    progress: { total: 8, done: 2, skipped: 0, pending: 6, overdue: 0 },
    tasks: [],
    ...extra,
  };
}

export function assignedGroup(extra: Partial<AssignedGroup> = {}): AssignedGroup {
  return { processId: 'p2', kind: 'onboarding', anchorDate: '2026-10-12', employee: lcPerson('u2', 'Raj Patel'), tasks: [], ...extra };
}
