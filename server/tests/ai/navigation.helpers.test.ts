import { AppPage, choosePage, PageRequest, pageByKey, pageDenied, PAGES, readPageRequest, samePlace } from '../../src/ai/modules/navigation.helpers';
import { IRole } from '../../src/models/role.model';
import { PLAN_FEATURES, PLAN_MODULES } from '../../src/constants/modules';
import { SubscriptionState } from '../../src/services/subscription.service';
import { admin, employeeUser } from './support';

const plan = (type: 'basic' | 'professional'): SubscriptionState => ({ planType: type, billingCycle: 'monthly', expiryDate: null, active: true, modules: [...PLAN_MODULES[type]], features: [...PLAN_FEATURES[type]] });
const roleWith = (...modules: string[]) => ({ permissions: modules.map((module) => ({ module, read: true, create: false, update: false, delete: false })) }) as unknown as IRole;

/** The page key each request would open for this user, or what else it is. */
function opens(message: string, who: 'admin' | 'user' = 'admin', opts: { bare?: boolean } = {}): string {
  const request = readPageRequest(message, opts);
  if (!request) return 'none';
  if (request.kind === 'list') return 'list';
  const user = who === 'admin' ? admin : employeeUser;
  const role = roleWith('projects', 'tasks', 'documents');
  const canOpen = (p: AppPage) => !pageDenied(p, user, plan('professional'), role);
  const pick = (r: Extract<PageRequest, { matches: unknown }>) => {
    const c = choosePage(r.matches, canOpen);
    return c.kind === 'one' ? c.page.key : c.kind === 'many' ? `many:${c.pages.map((p) => p.key).join(',')}` : `closed:${c.page.key}`;
  };
  if (request.kind === 'two') return 'two';
  const key = pick(request);
  return request.kind === 'go' ? key : request.kind === 'more' ? `more:${key}:${request.rest}` : `${request.kind}:${key}`;
}

describe('reading a page request (section 4)', () => {
  it.each([
    ['Jump to dashboard', 'home'],
    ['Go to the projects page', 'projects'],
    ['open the project module', 'projects'],
    ['Projects route', 'projects'],
    ['Take me to my leave', 'me-leave'],
    ['Hey, can you take me to my attendance please', 'me-attendance'],
    ['Navigate to the roles page', 'roles'],
    ['Switch to the summary tab', 'expenses-summary'],
    ['go to Approvals & leave', 'approvals'],
    ['Open audit logs', 'audit-logs'],
    ['Go to my to-dos', 'tasks'],
    ['projects page pe le chalo', 'projects'],
    ['leave types kholo', 'leave-types'],
    ['go to the welcome tab', 'home-welcome'],
    ['take me to people ops', 'onboarding'],
    ['go to onboarding templates', 'templates'],
    ['go to billing', 'billing'],
    ['change my password page', 'change-password'],
    ['Open my profile', 'profile'],
    ['open the profile tab', 'me-profile'],
    ['go to team attendance', 'team-attendance'],
    ['go to work from home requests', 'approvals-wfh'],
  ])('"%s" opens %s', (message, key) => {
    expect(opens(message)).toBe(key);
  });

  it('reads "show", "where" and "which pages"', () => {
    expect(opens('Show me the dashboard')).toBe('show:home');
    expect(opens('Show me the categories tab')).toBe('expenses-categories');
    expect(opens('Where are leave types?')).toBe('where:leave-types');
    expect(opens('Where do I set office hours?')).toBe('where:attendance-settings');
    expect(opens('How do I get to the documents page?')).toBe('where:documents');
    expect(opens('Which pages can I open?')).toBe('list');
    expect(opens('Where can I go')).toBe('list');
    expect(opens('show all pages')).toBe('list');
  });

  it('a page and more is a button and the rest; two pages are a question', () => {
    expect(opens('Go to projects and create Apollo')).toBe('more:projects:create Apollo');
    expect(opens('Take me to my attendance and request WFH tomorrow')).toBe('more:me-attendance:request WFH tomorrow');
    expect(opens('Open project Apollo')).toBe('more:projects:Open project Apollo');
    expect(opens('Go to projects and tasks')).toBe('two');
  });

  it('leaves everything else to the module', () => {
    expect(opens('Show projects')).toBe('show:projects'); // "show" on Projects itself is decided with the page (pageAnswer)
    expect(opens('Open the Apollo project')).toBe('none');
    expect(opens('Show employees in Engineering')).toBe('none');
    expect(opens('Show submitted claims for this month')).toBe('none');
    expect(opens('Open a new claim')).toBe('none');
    expect(opens('Move Apollo to on hold')).toBe('none');
    expect(opens('Projects')).toBe('none');
    expect(opens('Apply for leave from 3 Nov to 5 Nov')).toBe('none');
    expect(opens('Load all the audit logs for Leave')).toBe('none');
    expect(opens('Switch to dark mode')).toBe('none');
  });

  it('takes a page name alone only on the Navigation assistant', () => {
    expect(opens('Projects', 'admin', { bare: true })).toBe('projects');
    expect(opens('my leave', 'admin', { bare: true })).toBe('me-leave');
    expect(opens('Apollo', 'admin', { bare: true })).toBe('none');
  });
});

describe('same words, different pages (section 5)', () => {
  it.each([
    ['Go to holidays', 'holidays', 'me-holidays'],
    ['Go to expenses', 'expenses', 'me-expenses'],
    ['Go to claims', 'expenses', 'me-expenses'],
    ['Go to my claims', 'me-expenses', 'me-expenses'],
    ['Go to attendance', 'many:me-attendance,team-attendance', 'me-attendance'],
    ['Go to leave', 'me-leave', 'me-leave'],
    ['Go to leave approvals', 'approvals', 'closed:approvals'],
    ['Go to attendance fixes', 'approvals-fixes', 'me-attendance'],
    ['Go to my attendance fixes', 'me-attendance', 'me-attendance'],
    ['Go to roles', 'roles', 'closed:roles'],
    ['Go to plans', 'closed:plans', 'closed:plans'],
    ['Go to admin users', 'closed:admin-users', 'closed:admin-users'],
    ['Go to projects', 'projects', 'projects'],
    ['Go to employees', 'employees', 'closed:employees'],
    ['Go to the team', 'me-team', 'me-team'],
    ['Go to my leave requests', 'me-leave', 'me-leave'],
    ['Go to leave requests', 'approvals', 'me-leave'],
    ['Go to the login page', 'closed:sign-in', 'closed:sign-in'],
  ])('"%s": %s for an admin, %s for an employee', (message, forAdmin, forUser) => {
    expect(opens(message, 'admin')).toBe(forAdmin);
    expect(opens(message, 'user')).toBe(forUser);
  });

  it('offers the pages a refused one leaves open', () => {
    const request = readPageRequest('Go to team attendance') as Extract<PageRequest, { kind: 'go' }>;
    const choice = choosePage(request.matches, (p) => !pageDenied(p, employeeUser, plan('professional'), roleWith()));
    expect(choice).toMatchObject({ kind: 'closed', page: { key: 'team-attendance' } });
    expect((choice as Extract<typeof choice, { kind: 'closed' }>).others.map((p) => p.key).sort()).toEqual(['me-attendance', 'me-team']);
  });
});

describe('who may open a page (section 3)', () => {
  const page = (key: string) => pageByKey(key)!;

  it('follows the route guards', () => {
    expect(pageDenied(page('roles'), employeeUser, plan('professional'), roleWith())).toBe('org-admin');
    expect(pageDenied(page('plans'), admin, plan('professional'), null)).toBe('super-admin');
    expect(pageDenied(page('admin-users'), employeeUser, plan('professional'), roleWith())).toBe('super-admin');
    expect(pageDenied(page('projects'), employeeUser, plan('professional'), roleWith('tasks'))).toBe('permission');
    expect(pageDenied(page('projects'), employeeUser, plan('professional'), roleWith('projects'))).toBeNull();
    expect(pageDenied(page('projects'), admin, plan('professional'), null)).toBeNull();
    expect(pageDenied(page('home'), employeeUser, plan('professional'), roleWith())).toBeNull();
    expect(pageDenied(page('profile'), employeeUser, plan('professional'), roleWith())).toBeNull();
    expect(pageDenied(page('sign-in'), admin, plan('professional'), null)).toBe('never');
  });

  it('follows the plan, even for an admin', () => {
    expect(pageDenied(page('exports'), admin, plan('basic'), null)).toBe('plan');
    expect(pageDenied(page('audit-logs'), admin, plan('basic'), null)).toBe('plan');
    expect(pageDenied(page('me-performance'), employeeUser, plan('basic'), roleWith())).toBe('plan');
    expect(pageDenied(page('me-expenses'), employeeUser, plan('basic'), roleWith())).toBeNull();
    expect(pageDenied(page('expenses'), admin, { ...plan('professional'), features: [] }, null)).toBe('plan');
  });

  it('lists only real paths of the app, each once', () => {
    const keys = PAGES.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of PAGES) expect(p.path).toMatch(/^\/[a-z]/);
  });

  it('knows "already here" by page and tab', () => {
    expect(samePlace('/expenses', '/expenses?status=paid')).toBe(true);
    expect(samePlace('/expenses?tab=summary', '/expenses')).toBe(false);
    expect(samePlace('/home', '/home')).toBe(true);
    expect(samePlace('/home', undefined)).toBe(false);
  });
});
