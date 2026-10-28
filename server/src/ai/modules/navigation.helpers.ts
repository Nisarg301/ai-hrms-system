// Pure helpers of navigation (docs/AI_NAVIGATION_ASSISTANT.md): the app's pages, who may open
// each, and reading "Go to projects", "Jump to dashboard" or "Where are leave types?" from the
// words. The page list mirrors client/src/routes/AppRouter.tsx, navItems.tsx and pages/me/MePage.tsx.

import { ModuleName, PlanFeature } from '../../constants/modules';
import { IRole } from '../../models/role.model';
import { hasPermission } from '../../permissions/checkPermission';
import { SubscriptionState } from '../../services/subscription.service';
import { AuthenticatedUser } from '../../types/express';
import { norm } from '../text';

type UserRole = AuthenticatedUser['role'];
const ADMIN: UserRole[] = ['ORG_ADMIN'];
const MEMBERS: UserRole[] = ['ORG_ADMIN', 'ORG_USER'];
const ANYONE: UserRole[] = ['SUPER_ADMIN', 'ORG_ADMIN', 'ORG_USER'];

export interface AppPage {
  key: string;
  title: string;
  /** The final path: /dashboard, /leave, /people-ops and /me only redirect. */
  path: string;
  /** Where it is, for "Where is …?" ("Leave types is under **Approvals & leave** in the sidebar"). */
  place: string;
  /** Names that point here whoever asks (regular expressions over normalized text). */
  words: string[];
  /** Plain names (a Me tab's "leave", "claims"): only when no page the user may open fits better. */
  plain?: string[];
  roles: UserRole[];
  /** A permission-matrix module whose `read` right (and place in the plan) the page needs. */
  permission?: ModuleName;
  feature?: PlanFeature;
  /** A button in "Where can I go?". */
  main?: boolean;
  /** A page never opened while signed in (Sign in, Sign out): the answer instead. */
  never?: string;
  /** Offered when this page is refused: "Plans" → Billing & plan. */
  instead?: { key: string; text: string };
}

const SIDEBAR = (group?: string) => (group ? `under **${group}** in the sidebar` : 'in the sidebar');
const ME_TAB = 'a tab on **Me** in the sidebar';
const USER_MENU = 'in the menu under your name, top right';

export const PAGES: AppPage[] = [
  { key: 'home', title: 'Home', path: '/home', place: SIDEBAR(), roles: MEMBERS, main: true, words: ['home(?: ?page)?', 'dashboard', 'main page', 'landing page', 'start page'] },
  { key: 'home-welcome', title: 'Home → Welcome', path: '/home?tab=welcome', place: 'a tab on **Home**', roles: MEMBERS, words: ['welcome(?: tab| page| screen)?'] },
  {
    key: 'me-leave',
    title: 'Me → Leave',
    path: '/me/leave',
    place: ME_TAB,
    roles: MEMBERS,
    main: true,
    words: ['my leaves?(?: requests?| applications?| history)?', '(?:my )?leave balances?', 'my time off', 'me page', 'me tab', 'me section', 'leave tab'],
    plain: ['leaves?', 'time off', 'leave requests?'],
  },
  {
    key: 'me-attendance',
    title: 'Me → Attendance',
    path: '/me/attendance',
    place: ME_TAB,
    roles: MEMBERS,
    main: true,
    words: ['my attendance(?: fix(?:es)?| requests?| history)?', 'my (?:wfh|work from home)(?: requests?)?', 'my (?:attendance )?fix(?:es)?', 'attendance tab'],
    plain: ['attendance', '(?:wfh|work from home)(?: requests?)?', 'attendance fix(?:es)?(?: requests?)?', '(?:fix|regulari[sz]ation) requests?', 'regulari[sz]ations?'],
  },
  {
    key: 'me-expenses',
    title: 'Me → Expenses',
    path: '/me/expenses',
    place: ME_TAB,
    roles: MEMBERS,
    feature: 'expenses',
    main: true,
    words: ['my (?:expenses?|claims?|expense claims?|reimbursements?)'],
    plain: ['expenses?', 'claims?', 'expense claims?', 'reimbursements?', 'expenses tab'],
  },
  {
    key: 'me-performance',
    title: 'Me → Performance',
    path: '/me/performance',
    place: ME_TAB,
    roles: MEMBERS,
    feature: 'performance',
    words: ['(?:my )?performance(?: reviews?| tab)?', '(?:my )?goals?', '(?:my )?reviews?', '(?:my )?appraisals?', 'reviews to write'],
  },
  { key: 'me-profile', title: 'Me → Profile', path: '/me/profile', place: ME_TAB, roles: MEMBERS, words: ['profile tab', 'me profile', '(?:my )?job details', '(?:my )?employment details', 'my introduction'] },
  { key: 'me-team', title: 'Me → Team', path: '/me/team', place: ME_TAB, roles: MEMBERS, words: ['my team', 'team tab', '(?:my )?colleagues', '(?:my )?teammates', '(?:my )?team members'], plain: ['team'] },
  {
    key: 'me-holidays',
    title: 'Me → Holidays',
    path: '/me/holidays',
    place: ME_TAB,
    roles: MEMBERS,
    words: ['my holidays?', 'holidays? tab'],
    plain: ['holidays?', 'holiday (?:list|calendar)', 'public holidays?'],
  },
  {
    key: 'approvals',
    title: 'Approvals',
    path: '/leave/approvals',
    place: SIDEBAR('Approvals & leave'),
    roles: ADMIN,
    main: true,
    words: ['approvals?', 'leave approvals?', 'approvals? and leaves?', 'leave requests?', 'pending requests', 'approval requests', 'requests to approve', 'leave management', 'approve (?:some |the |all |pending )?(?:leaves?|requests?)'],
  },
  {
    key: 'approvals-fixes',
    title: 'Approvals → Attendance fixes',
    path: '/leave/approvals?tab=fixes',
    place: 'a tab of **Approvals**, under **Approvals & leave** in the sidebar',
    roles: ADMIN,
    words: ['attendance fix(?:es)?(?: requests?| approvals?)?', '(?:fix|regulari[sz]ation) (?:requests?|approvals?)', 'regulari[sz]ations?'],
  },
  {
    key: 'approvals-wfh',
    title: 'Approvals → Work from home',
    path: '/leave/approvals?tab=wfh',
    place: 'a tab of **Approvals**, under **Approvals & leave** in the sidebar',
    roles: ADMIN,
    words: ['(?:wfh|work from home) (?:requests?|approvals?)'],
  },
  {
    key: 'approvals-expenses',
    title: 'Approvals → Expenses',
    path: '/leave/approvals?tab=expenses',
    place: 'a tab of **Approvals**, under **Approvals & leave** in the sidebar',
    roles: ADMIN,
    feature: 'expenses',
    words: ['(?:expense|claim)s? approvals?', '(?:expenses?|claims?) to approve', 'approve (?:some |the |all |pending )?(?:expenses?|claims?)', 'expense requests?'],
  },
  {
    key: 'team-attendance',
    title: 'Team attendance',
    path: '/leave/team-attendance',
    place: SIDEBAR('Approvals & leave'),
    roles: ADMIN,
    words: ['team(?: s)? attendance', 'everyone s attendance', 'attendance of (?:the |my )?team', 'attendance (?:report|register|sheet)'],
    plain: ['attendance'],
  },
  { key: 'leave-types', title: 'Leave types', path: '/leave/types', place: SIDEBAR('Approvals & leave'), roles: ADMIN, words: ['leave types?', 'types of leaves?', 'leave polic(?:y|ies)'] },
  {
    key: 'holidays',
    title: 'Holidays',
    path: '/leave/holidays',
    place: SIDEBAR('Approvals & leave'),
    roles: ADMIN,
    words: ['holidays?', 'holiday (?:list|calendar)', 'public holidays?', 'manage holidays'],
  },
  {
    key: 'attendance-settings',
    title: 'Attendance settings',
    path: '/leave/attendance-settings',
    place: SIDEBAR('Approvals & leave'),
    roles: ADMIN,
    words: ['attendance settings?', 'office (?:hours|timings?)', 'work(?:ing)? hours', 'shift (?:settings?|timings?)'],
  },
  {
    key: 'expenses',
    title: 'Expenses → Claims',
    path: '/expenses',
    place: SIDEBAR(),
    roles: ADMIN,
    feature: 'expenses',
    main: true,
    words: ['expenses?', 'claims?', 'expense claims?', 'all (?:the )?claims', 'everyone s claims', 'reimbursements?', 'expense management', 'claims tab'],
  },
  {
    key: 'expenses-summary',
    title: 'Expenses → Summary',
    path: '/expenses?tab=summary',
    place: 'a tab of **Expenses** in the sidebar',
    roles: ADMIN,
    feature: 'expenses',
    words: ['(?:expenses?|spending) summary', 'spending', 'summary tab', 'expense report'],
  },
  {
    key: 'expenses-categories',
    title: 'Expenses → Categories',
    path: '/expenses?tab=categories',
    place: 'a tab of **Expenses** in the sidebar',
    roles: ADMIN,
    feature: 'expenses',
    words: ['(?:expense )?categor(?:y|ies)(?: tab)?'],
  },
  {
    key: 'onboarding',
    title: 'People ops → Onboarding',
    path: '/people-ops/onboarding',
    place: SIDEBAR('People ops'),
    roles: ADMIN,
    feature: 'onboarding',
    main: true,
    words: ['onboarding', 'people ops', 'people operations', 'joining checklists?', 'new joiners'],
  },
  { key: 'offboarding', title: 'People ops → Offboarding', path: '/people-ops/offboarding', place: SIDEBAR('People ops'), roles: ADMIN, feature: 'onboarding', words: ['offboarding', '(?:exit|leaving) checklists?', 'exits'] },
  { key: 'templates', title: 'People ops → Templates', path: '/people-ops/templates', place: SIDEBAR('People ops'), roles: ADMIN, feature: 'onboarding', words: ['templates?', 'checklist templates?', '(?:onboarding|offboarding) templates?'] },
  { key: 'roles', title: 'Roles', path: '/roles', place: SIDEBAR(), roles: ADMIN, main: true, words: ['roles?', 'roles? and permissions?', 'permissions?', 'role management', 'access control'] },
  { key: 'employees', title: 'Employees', path: '/employees', place: SIDEBAR(), roles: MEMBERS, permission: 'employees', main: true, words: ['employees?', 'employee (?:list|directory)', 'staff', 'people', 'workforce'] },
  { key: 'documents', title: 'Documents', path: '/documents', place: SIDEBAR(), roles: MEMBERS, permission: 'documents', main: true, words: ['documents?', 'docs', 'files', 'document library'] },
  { key: 'projects', title: 'Projects', path: '/projects', place: SIDEBAR(), roles: MEMBERS, permission: 'projects', main: true, words: ['projects?'] },
  { key: 'departments', title: 'Departments', path: '/departments', place: SIDEBAR(), roles: MEMBERS, permission: 'departments', main: true, words: ['departments?', 'depts?'] },
  { key: 'tasks', title: 'Tasks', path: '/tasks', place: SIDEBAR(), roles: MEMBERS, permission: 'tasks', main: true, words: ['tasks?', 'to ?dos?', 'todo list'] },
  { key: 'exports', title: 'Exports', path: '/exports', place: SIDEBAR(), roles: MEMBERS, permission: 'exports', main: true, words: ['exports?', '(?:data|csv) exports?', 'export page', 'downloads?'] },
  { key: 'audit-logs', title: 'Audit Logs', path: '/audit-logs', place: SIDEBAR(), roles: MEMBERS, permission: 'auditLogs', main: true, words: ['audit(?: logs?| trail)?', 'activity logs?', 'logs'] },
  { key: 'profile', title: 'Profile', path: '/profile', place: USER_MENU, roles: ANYONE, words: ['(?:my )?profile(?: page| settings)?', '(?:my )?account(?: settings)?', 'edit (?:my )?profile'] },
  { key: 'change-password', title: 'Change password', path: '/change-password', place: USER_MENU, roles: ANYONE, words: ['(?:change|update|reset)(?: my)? password', 'password'] },
  {
    key: 'billing',
    title: 'Billing & plan',
    path: '/billing',
    place: USER_MENU,
    roles: ADMIN,
    words: ['billing(?: and plan)?', 'subscription', '(?:my |our )?plan', 'payments?', 'invoices?', 'upgrade'],
  },
  { key: 'admin-users', title: 'Admin Users', path: '/admin-users', place: SIDEBAR(), roles: ['SUPER_ADMIN'], words: ['admin users?', 'super admin', 'organi[sz]ations?', 'tenants?'] },
  {
    key: 'plans',
    title: 'Plans',
    path: '/plans',
    place: SIDEBAR(),
    roles: ['SUPER_ADMIN'],
    words: ['plans', 'pricing(?: plans?)?', 'manage plans', 'plan management'],
    instead: { key: 'billing', text: "Your organization's own plan is on **Billing & plan**." },
  },
  {
    key: 'sign-in',
    title: 'Sign in',
    path: '/login',
    place: 'shown when signed out',
    roles: ANYONE,
    words: ['log ?in(?: page)?', 'sign ?in(?: page)?', 'forgot(?: my)? password', 'sign ?up', 'register'],
    never: "You're already signed in. To use another account, sign out from the menu under your name first.",
  },
  {
    key: 'sign-out',
    title: 'Sign out',
    path: '/login',
    place: USER_MENU,
    roles: ANYONE,
    words: ['log ?out', 'log ?off', 'sign ?out'],
    never: 'To sign out, use **Sign out** in the menu under your name, top right.',
  },
];

export const pageByKey = (key: string) => PAGES.find((p) => p.key === key);

/** Each assistant's own page, when the drawer didn't say where it is. */
const MODULE_PAGES: Record<string, string> = {
  employees: '/employees',
  projects: '/projects',
  departments: '/departments',
  exports: '/exports',
  tasks: '/tasks',
  documents: '/documents',
  roles: '/roles',
  expenses: '/expenses',
  leave: '/me/leave',
  attendance: '/me/attendance',
  'my-expenses': '/me/expenses',
  auditLogs: '/audit-logs',
};
export const moduleHome = (moduleKey: string): string | undefined => MODULE_PAGES[moduleKey];

// ---- who may open a page (the client's RoleRoute, PermissionRoute and plan checks)

export type Denial = 'never' | 'super-admin' | 'org-admin' | 'plan' | 'permission';

/**
 * Why this user may not open the page, or null when they may. The same order as the app: the
 * role first, then the plan (a module or feature outside it doesn't exist), then the role's
 * `read` right. No subscription (tests) means no plan restriction, as on the client.
 */
export function pageDenied(page: AppPage, user: AuthenticatedUser, subscription: SubscriptionState | undefined, role: IRole | null): Denial | null {
  if (page.never) return 'never';
  if (!page.roles.includes(user.role)) return page.roles.length === 1 && page.roles[0] === 'SUPER_ADMIN' ? 'super-admin' : 'org-admin';
  if (subscription) {
    if (page.feature && !subscription.features.includes(page.feature)) return 'plan';
    if (page.permission && !subscription.modules.includes(page.permission)) return 'plan';
  }
  if (page.permission && !hasPermission(user, role, page.permission, 'read')) return 'permission';
  return null;
}

// ---- reading the request

/** "Approvals & leave" and "approvals and leave" read the same; so do "To-dos" and "to dos". */
const clean = (text: string) => norm(text.replace(/&/g, ' and '));

const W = (source: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'gu');
const PATTERNS = PAGES.map((page) => ({ page, words: page.words.map(W), plain: (page.plain ?? []).map(W) }));

const POLITE = /^(?:(?:hey|hi|hello|ok|okay|so|now|and|then|please|pls|plz|kindly|assistant|just|quickly|can you|could you|would you|will you|can u|could u|i want you to|i d like you to)\s+)+/;
const GO =
  /^(?:(?:go|come)(?: back)?(?: over)? to|goto|take me(?: back)?(?: over)? to|bring me(?: back)? to|get me to|jump(?: back)?(?: over)? to|navigate(?: me)?(?: back)? to|redirect(?: me)?(?: back)? to|switch(?: back)?(?: over)? to|move(?: me)? to|head(?: over| back)? to|visit|open(?: up)?|launch|i (?:want|wanna|need|would like|d like) to (?:go|get|move|jump|navigate|switch) to|let s go to|lets go to)\s+/;
const SHOW = /^(?:show(?: me)?|display|view|see|pull up|bring up|i (?:want|wanna|need|would like|d like) to see)\s+/;
// "Where do I set office hours?": the verb belongs to the question, not to the page's name.
const WHERE_VERB = '(?:go to|find|see|view|set|change|manage|edit|add|approve|check|update)';
const WHERE = new RegExp(
  `^(?:where (?:do|can|would|should) i(?: ${WHERE_VERB})?|where to ${WHERE_VERB}|how (?:do|can) i (?:get|go) to|how to (?:get|go) to|how do i find|where(?: is| are| s)?)\\s+`
);
// Hinglish: "projects page pe le chalo", "leave types kholo", "dashboard dikhao".
const HINDI_GO = /\s+(?:(?:pe|par|per|mein|me|ko)\s+)?(?:le chalo|le chal|le jao|le jaao|jao|jaao|chalo|kholo|khol do|kholiye|open karo|open kar do)$/;
const HINDI_SHOW = /\s+(?:ko\s+)?(?:dikhao|dikha do|dikhaiye)$/;
const NOUN = /(?<![\p{L}\p{N}])(?:page|route|module|screen|section|tab)(?![\p{L}\p{N}])/u;
const LIST =
  /^(?:where (?:all )?can i go|what can i open|(?:what|which) (?:pages|screens|modules|sections|routes)\b|(?:list|show)(?: me)?(?: all)?(?: the)? (?:pages|screens|modules|routes|menu)\b|all (?:the )?(?:pages|screens|modules|routes)\b|site ?map\b|navigation menu\b)/;

// Words that may sit around a page name: "the projects page please", "my tasks list".
const FILLER = new Set(
  'the a an my our all page pages route routes module modules screen section tab menu area please pls plz now right for me app application of in on here there quickly again back list view sidebar link go instead then first ok okay just to i can do is are it see find get up karo pe par per mein ko this that its'.split(' ')
);

export interface PageMatch {
  page: AppPage;
  /** Characters matched: the longest name wins ("team attendance" over "team"). */
  length: number;
  plain: boolean;
  start: number;
  end: number;
}

export type PageRequest =
  | { kind: 'list' }
  /**
   * go: open it; show: open it if it isn't this page; where: say where, with a button.
   * `model`: the model's pick (go_to_page), never opened unless the user's words name the page.
   */
  | { kind: 'go' | 'show' | 'where'; matches: PageMatch[]; model?: boolean }
  /** "Go to projects and create Apollo": a button, and the rest to ask there. */
  | { kind: 'more'; matches: PageMatch[]; rest: string }
  /** "Go to projects and tasks". */
  | { kind: 'two'; first: PageMatch[]; second: PageMatch[] };

/** Every page named in the text, each with its longest name. */
export function findPages(text: string): PageMatch[] {
  const found = new Map<string, PageMatch>();
  for (const { page, words, plain } of PATTERNS) {
    for (const [regexes, isPlain] of [[words, false], [plain, true]] as const) {
      for (const re of regexes) {
        for (const m of text.matchAll(re)) {
          const match = { page, length: m[0].length, plain: isPlain, start: m.index!, end: m.index! + m[0].length };
          const known = found.get(page.key);
          if (!known || match.length > known.length) found.set(page.key, match);
        }
      }
    }
  }
  return [...found.values()];
}

/** The pages named anywhere in a text (the model's words for go_to_page). */
export const pagesIn = (text: string) => findPages(clean(text));

export const longest = (matches: PageMatch[]) => Math.max(0, ...matches.map((m) => m.length));
const others = (words: string[]) => words.filter((w) => !FILLER.has(w));
const wordsOf = (text: string) => text.split(' ').filter(Boolean);

/** A text that is a page name and nothing else ("the tasks page"): its matches, or null. */
function pureName(text: string): PageMatch[] | null {
  const matches = findPages(text);
  if (!matches.length) return null;
  const top = matches.find((m) => m.length === longest(matches))!;
  const left = others(wordsOf(`${text.slice(0, top.start)} ${text.slice(top.end)}`));
  return left.length ? null : matches;
}

/**
 * The user's own words name this page, or a word of its title: "approve" for Approvals, "holiday"
 * for Holidays. The model's pick for "Open payroll" (Expenses) is not heard, so it isn't opened.
 */
export function heardPage(page: AppPage, message: string): boolean {
  const t = clean(message);
  if (findPages(t).some((m) => m.page.key === page.key)) return true;
  const stems = new Set(wordsOf(t).filter((w) => w.length >= 4).map((w) => w.slice(0, 5)));
  return wordsOf(clean(page.title)).some((w) => w.length >= 4 && stems.has(w.slice(0, 5)));
}

/** True when the message asks to go somewhere: a navigation verb or a page word ("page", "tab"). */
export function asksToGo(message: string): boolean {
  const t = clean(message).replace(POLITE, '');
  return GO.test(`${t} `) || HINDI_GO.test(t) || NOUN.test(t);
}

/**
 * A request to open a page, read from the words (docs section 4), or null when the message is
 * something else. `bare`: a page name on its own counts too (the Navigation assistant only).
 */
export function readPageRequest(message: string, opts: { bare?: boolean } = {}): PageRequest | null {
  let t = clean(message).replace(POLITE, '');
  if (!t) return null;
  if (LIST.test(t)) return { kind: 'list' };
  let cue: 'go' | 'show' | 'where' | null = null;
  for (const [re, kind] of [[GO, 'go'], [WHERE, 'where'], [SHOW, 'show']] as const) {
    const m = re.exec(`${t} `);
    if (m) {
      cue = kind;
      t = t.slice(m[0].length).trim();
      break;
    }
  }
  if (!cue && HINDI_GO.test(t)) {
    cue = 'go';
    t = t.replace(HINDI_GO, '');
  } else if (!cue && HINDI_SHOW.test(t)) {
    cue = 'show';
    t = t.replace(HINDI_SHOW, '');
  }
  const noun = NOUN.test(t);
  if (!cue && !noun && !opts.bare) return null;
  // "Show me the categories tab" names the page itself: open it, even on its own assistant.
  if (cue === 'show' && noun) cue = 'go';

  const matches = findPages(t);
  if (!matches.length) return null;
  const top = matches.filter((m) => m.length === longest(matches)).sort((a, b) => a.start - b.start)[0];
  const before = others(wordsOf(t.slice(0, top.start)));
  const after = others(wordsOf(t.slice(top.end)));
  if (!before.length && !after.length) return { kind: cue ?? 'go', matches };

  // Something after the page name: only for "go to <page> …".
  if (cue !== 'go' || before.length) return null;
  const joined = /^\s*(?:and then|and also|and|then|also)\s+/.exec(t.slice(top.end));
  const tail = t.slice(top.end + (joined?.[0].length ?? 0)).trim();
  const first = matches.filter((m) => m.end <= top.end);
  const second = joined ? pureName(tail) : null;
  if (second) return { kind: 'two', first, second };
  // "… and create Apollo" is asked there as it is; "Open project Apollo" is asked there whole.
  const rest = joined ? (restOf(message, others(wordsOf(tail))[0]) ?? tail) : message.trim().replace(/[.!?]+$/, '');
  return { kind: 'more', matches: first, rest };
}

/** The message as typed, from the first word after the page name: "create Apollo". */
function restOf(message: string, firstWord: string | undefined): string | null {
  if (!firstWord) return null;
  const at = message.search(new RegExp(`(?<![\\p{L}\\p{N}])${firstWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu'));
  return at >= 0 ? message.slice(at).trim().replace(/[.!?]+$/, '') : null;
}

export type PageChoice = { kind: 'one'; page: AppPage } | { kind: 'many'; pages: AppPage[] } | { kind: 'closed'; page: AppPage; others: AppPage[] };

const uniquePages = (matches: PageMatch[]) => [...new Map(matches.map((m) => [m.page.key, m.page])).values()];

/**
 * The page meant, for this user (docs section 5): the longest name; among the pages they may open
 * with it, a strong name over a plain one; several left is a question. When the longest name only
 * fits pages they may not open, the first of those is refused, with up to two they may open.
 */
export function choosePage(matches: PageMatch[], canOpen: (page: AppPage) => boolean): PageChoice {
  const length = longest(matches);
  const top = matches.filter((m) => m.length === length);
  const open = top.filter((m) => canOpen(m.page));
  if (open.length) {
    const strong = open.filter((m) => !m.plain);
    const pages = uniquePages(strong.length ? strong : open);
    return pages.length === 1 ? { kind: 'one', page: pages[0] } : { kind: 'many', pages };
  }
  const strong = top.filter((m) => !m.plain);
  const page = uniquePages(strong.length ? strong : top)[0];
  return { kind: 'closed', page, others: uniquePages(matches.filter((m) => m.length < length && canOpen(m.page))).slice(0, 2) };
}

// ---- paths

const pathOf = (path: string) => path.split('?')[0];
const tabOf = (path: string) => new URLSearchParams(path.split('?')[1] ?? '').get('tab');

/** The same page and tab ("/expenses?status=paid" is the Claims tab of "/expenses"). */
export function samePlace(path: string, here: string | undefined): boolean {
  if (!here) return false;
  return pathOf(path) === pathOf(here) && tabOf(path) === tabOf(here);
}

/** The same page, whatever the tab: "show" there is that page's own work. */
export const samePage = (path: string, here: string | undefined) => Boolean(here) && pathOf(path) === pathOf(here!);
