// Pure helpers for the Audit Logs assistant (docs/AI_AUDIT_LOGS_ASSISTANT.md, section 3): the
// module, action and dates a request names, read from the user's own words.

import { AUDIT_ACTIONS, AUDIT_MODULES } from '../../models/auditLog.model';
import { addDays, APP_TIMEZONE, zonedInstant } from '../../utils/dates';
import { dateRange, DateRange } from './expense.helpers';

export type AuditModule = (typeof AUDIT_MODULES)[number];
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** The page's labels (AuditLogsPage.tsx). The Dashboard and Exports are matrix modules but not audited. */
export const MODULE_LABELS: Partial<Record<AuditModule, string>> = {
  employees: 'Employees',
  documents: 'Documents',
  departments: 'Departments',
  projects: 'Projects',
  tasks: 'Tasks',
  roles: 'Roles',
  leave: 'Leave',
  holidays: 'Holidays',
  announcements: 'Announcements',
  posts: 'Posts',
  attendance: 'Attendance',
  expenses: 'Expenses',
  onboarding: 'Onboarding & offboarding',
  performance: 'Performance',
};

export const ACTION_LABELS: Record<AuditAction, string> = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  login: 'Signed in',
  logout: 'Signed out',
};

// A word of its own: "post-lunch" isn't Posts, and "logs" isn't a login.
const W = (words: string) => new RegExp(`(?<![\\w-])(?:${words})(?![\\w-])`, 'gi');

const MODULE_WORDS: [AuditModule, RegExp][] = [
  ['employees', W('employees?|staff|people|team members?')],
  ['documents', W('documents?|docs?')],
  ['departments', W('departments?|depts?')],
  ['projects', W('projects?')],
  ['tasks', W('tasks?|to-?dos?')],
  ['roles', W('roles?|permissions?')],
  ['leave', W('leaves?|leave requests?|time off|chutti')],
  ['holidays', W('holidays?')],
  ['announcements', W('announcements?')],
  ['posts', W('posts?|(?:the )?(?:home )?feed')],
  ['attendance', W('attendance|work from home|wfh|fix(?:es)?|regulari[sz]ations?')],
  ['expenses', W('expenses?|expense claims?|claims?|reimbursements?')],
  ['onboarding', W('onboarding|offboarding|on-?boarding|off-?boarding|people ops|checklists?')],
  ['performance', W('performance|goals?|(?:performance )?reviews')],
];

// Sign-ins first: "sign in" must not leave "in" behind, and "signed out" is its own.
const ACTION_WORDS: [AuditAction, RegExp][] = [
  ['login', W('signed[ -]?in|sign[ -]?ins?|logged[ -]?in|log[ -]?ins?|logins?')],
  ['logout', W('signed[ -]?out|sign[ -]?outs?|logged[ -]?out|log[ -]?outs?|logouts?')],
  ['create', W('created|creates?|creation|added|adds?|new')],
  ['update', W('updated|updates?|edited|edits?|changed|modified|modif(?:y|ies)')],
  ['delete', W('deleted|deletes?|deletion|removed|removes?')],
];

/** Every module the words name, in the order they're said. */
export function modulesIn(text: string): AuditModule[] {
  return matchesIn(text, MODULE_WORDS);
}

/** Every action the words name, in the order they're said. */
export function actionsIn(text: string): AuditAction[] {
  return matchesIn(text, ACTION_WORDS);
}

function matchesIn<T>(text: string, words: [T, RegExp][]): T[] {
  let t = ` ${text.toLowerCase()} `;
  const found: { value: T; at: number }[] = [];
  for (const [value, pattern] of words) {
    const m = new RegExp(pattern.source, 'i').exec(t);
    if (m) {
      found.push({ value, at: m.index });
      // Taken out, so "sign in" isn't also a "new" or an "in".
      t = t.replace(pattern, (s) => ' '.repeat(s.length));
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.value);
}

/** The dates the words name, as the page sends them: 00:00 of the first day to the end of the last, in APP_TIMEZONE. */
export function auditRange(text: string, today: string): (DateRange & { fromInstant?: string; toInstant?: string }) | null {
  const range = dateRange(text, today);
  if (!range) return null;
  return {
    ...range,
    fromInstant: range.from ? zonedInstant(range.from, '00:00').toISOString() : undefined,
    toInstant: range.to ? new Date(zonedInstant(addDays(range.to, 1), '00:00').getTime() - 1).toISOString() : undefined,
  };
}

const WHEN = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIMEZONE, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "22 Oct 2026, 14:05", in the organization's time zone, as the page shows it. */
export const whenText = (iso: string) => WHEN.format(new Date(iso));
