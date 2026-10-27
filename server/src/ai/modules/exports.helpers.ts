// Pure helpers for the Exports assistant (docs/AI_EXPORTS_ASSISTANT.md, sections 2, 6 and 9).
// They read which exports a message asks for; exports.module.ts checks the user's rights
// and builds the answer.

import { EXPORTABLE_MODULES } from '../../controllers/export.controller';
import { norm } from '../text';

export { EXPORTABLE_MODULES };
export type ExportableModule = (typeof EXPORTABLE_MODULES)[number];

/** What each export holds: the columns of export.controller's exporters, in words. */
export const EXPORTS: Record<ExportableModule, { label: string; noun: string; columns: string[] }> = {
  employees: { label: 'Employees', noun: 'employee', columns: ['name', 'email', 'job title', 'department', 'role', 'status'] },
  documents: { label: 'Documents', noun: 'document', columns: ['title', 'description', 'category', 'status', 'file name'] },
  projects: { label: 'Projects', noun: 'project', columns: ['name', 'description', 'deadline', 'status'] },
  tasks: { label: 'Tasks', noun: 'task', columns: ['title', 'description', 'due date', 'status', 'project', 'members'] },
};

// All patterns run on norm()-ed text: lower case, punctuation turned into spaces.
const MODULE_WORDS: Record<ExportableModule, RegExp> = {
  employees: /\b(?:employees?|staff|people|team members?|workforce|users?|karmchar(?:i|iyon))\b/,
  documents: /\b(?:documents?|docs?)\b/,
  projects: /\bprojects?\b/,
  tasks: /\b(?:tasks?|to ?dos?)\b/,
};
const ALL = /\b(?:all|everything|every|each|sab|sabhi|saare|sare|sara)\b/;
// Checked before the other exclusions, so its "everything" still counts.
const ALL_BUT = /\b(?:all|everything)\s+but\b/;
// The data left out comes after these ("everything except projects")…
const EXCEPT = /\b(?:except(?: for)?|excluding|exclude|without|other than|apart from|but not|do not|don t|dont|not|leave out|leaving out|skip(?:ping)?|minus)\b/;
// …and before these Hindi ones ("projects ke alawa sab": all but projects).
const EXCEPT_AFTER = /\b(?:chh?od ?kar|ke alawa|ke siwa|ke siva)\b/;
// Information questions get Download buttons instead of downloads. "Can you…" is a request.
const QUESTION = /^(?:what|whats|which|how|why|does|is|are|was|when|where|who|tell me|explain|do(?! not\b))\b/;

const modulesIn = (text: string) => EXPORTABLE_MODULES.filter((m) => MODULE_WORDS[m].test(text));

export interface ExportRequest {
  /** What to download, in the page's order. */
  modules: ExportableModule[];
  /** Every export was asked for ("all", or only exclusions): ones the user can't read are left out quietly. */
  everything: boolean;
  /** The words named an export, "all" or an exclusion. */
  named: boolean;
}

/** "employees and projects" → both; "everything except documents" → the other three; "all employees" → Employees. */
export function readRequest(text: string): ExportRequest {
  const t = norm(text);
  const allBut = ALL_BUT.exec(t);
  const except = allBut ?? EXCEPT.exec(t);
  const after = except ? null : EXCEPT_AFTER.exec(t);
  let include = t;
  let exclude = '';
  if (except) [include, exclude] = [t.slice(0, except.index), t.slice(except.index + except[0].length)];
  else if (after) [exclude, include] = [t.slice(0, after.index), t.slice(after.index + after[0].length)];
  const included = modulesIn(include);
  const excluded = modulesIn(exclude);
  // "all" means every export only when none is named: "all employees" is the Employees export.
  const everything = !included.length && (Boolean(allBut) || ALL.test(include) || excluded.length > 0);
  const modules = (everything ? [...EXPORTABLE_MODULES] : included).filter((m) => !excluded.includes(m));
  return { modules, everything, named: everything || included.length > 0 };
}

export function isQuestion(text: string): boolean {
  return QUESTION.test(norm(text));
}

const SPELLINGS: Record<ExportableModule, string[]> = {
  employees: ['employee', 'employees'],
  documents: ['document', 'documents'],
  projects: ['project', 'projects'],
  tasks: ['task', 'tasks'],
};

/** Edit distance: how many letters to add, drop or change to turn `a` into `b`. */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/** Whether the text names the export, allowing a small misspelling ("emplyees", "taks"). */
export function mentionsExport(text: string, module: ExportableModule): boolean {
  const t = norm(text);
  if (MODULE_WORDS[module].test(t)) return true;
  return t.split(' ').some((w) => w.length >= 4 && SPELLINGS[module].some((s) => distance(w, s) <= (w.length >= 7 ? 2 : 1)));
}

const NOTHING: ExportRequest = { modules: [], everything: false, named: false };

/**
 * The model's reading, kept only where the user's own words back it: each export must be
 * named (or nearly spelled) in what the user said, and "all" counts only when a message of
 * theirs asked for everything. In testing, the model copied "all except documents" from its
 * own instructions for "Download attendance".
 */
export function backedByUser(request: ExportRequest, userText: string): ExportRequest {
  if (request.everything) return userText.split('\n').some((line) => readRequest(line).everything) ? request : NOTHING;
  const modules = request.modules.filter((m) => mentionsExport(userText, m));
  return modules.length ? { modules, everything: false, named: true } : NOTHING;
}

// The other words a plain command may have. A message with any word not here goes to the model.
const COMMAND_WORDS = new Set(
  `download downloads downloading export exports exporting csv csvs file files sheet sheets spreadsheet spreadsheets excel
  data list lists record records report reports details table tables info
  the a an of for to as in into on from with and or plus also too then
  me my our us i we you please pls plz kindly can could would will want wanna need give get send pull grab fetch share
  now just only at once together separately separate them it this that these those one two three four
  hey hi ok okay thanks thank module modules page s
  mujhe muje hume humein mera meri ki ka ke ko de do dena dedo dijiye karo kar karna karke kardo krdo hai hain
  chahiye bhej bhejo nikal nikalo aur ya bhi kuch wala wali wale`.split(/\s+/)
);
const STRIP = [ALL_BUT, EXCEPT, EXCEPT_AFTER, ...Object.values(MODULE_WORDS), ALL].map((re) => new RegExp(re.source, 'g'));

/**
 * A plain command the server reads without the model ("Download employees and projects"), or
 * null. Only when every word is a known export word: anything else, a filter, a typo or a
 * question, is left to the model.
 */
export function plainRequest(text: string): ExportRequest | null {
  const t = norm(text);
  if (!t || isQuestion(text)) return null;
  const rest = STRIP.reduce((s, re) => s.replace(re, ' '), t);
  if (rest.split(' ').some((w) => w && !COMMAND_WORDS.has(w))) return null;
  const request = readRequest(text);
  return request.named ? request : null;
}

// Words that ask for files now. Naming data is not enough on its own: "projects are important to
// me" names projects, and a "thank you" after a download once downloaded the files again.
const EXPORT_INTENT =
  /\b(?:download|downloads|export|exports|csvs?|excel|spreadsheets?|sheets?|files?|data|reports?|records|lists?|again|same|repeat|redo|one more|need|want|wanted|give|get|send|share|pull|fetch|grab|please|pls|plz|bhej|bhejo|de do|dedo|dena|chahiye|nikal|nikalo)\b/;

/**
 * Whether the message asks for a download now: it says so ("download", "CSV", "I need", "again")
 * or it is a plain command such as "projects and tasks" (section 6).
 */
export function asksForExport(text: string): boolean {
  return EXPORT_INTENT.test(norm(text)) || plainRequest(text) !== null;
}

/** Data the user named that isn't on this page: where to get it instead. */
export function elsewhereNotes(text: string, admin: boolean): string[] {
  const t = norm(text);
  const adminsOnly = admin ? '' : ' (admins only)';
  const notes: [RegExp, string][] = [
    [/\battendance\b/, `Attendance is exported from the Team attendance page${adminsOnly}.`],
    [/\b(?:expenses?|claims?|reimbursements?)\b/, `Expenses are exported from the Claims tab of the Expenses page${adminsOnly}.`],
    [/\bdepartments?\b/, "There's no Departments export, but the Employees CSV has each employee's department."],
    [/\broles?\b/, "There's no Roles export, but the Employees CSV has each employee's role."],
  ];
  return notes.filter(([pattern]) => pattern.test(t)).map(([, note]) => note);
}

/** "as Excel" or "as PDF": what the user gets instead. */
export function formatNote(text: string): string | null {
  const t = norm(text);
  if (/\b(?:pdf|json|xml|docx|word (?:file|document))\b/.test(t)) return 'Exports are CSV only. CSV files open in Excel and Google Sheets.';
  if (/\b(?:excel|xlsx|xls|spreadsheets?|google sheets?)\b/.test(t)) return 'CSV files open in Excel and Google Sheets.';
  return null;
}

// Words that ask for only some rows. Exports always hold every record.
const FILTER_WORDS = /\b(?:active|inactive|disabled|overdue|pending|completed|archived|(?:this|last) (?:week|month|year)|today|yesterday|since|between|before|after)\b/;

export function asksForFilter(text: string): boolean {
  return FILTER_WORDS.test(norm(text));
}
