import { attendanceModule } from '../../src/ai/modules/attendance.module';
import { auditLogModule } from '../../src/ai/modules/auditLog.module';
import { departmentModule } from '../../src/ai/modules/department.module';
import { documentModule } from '../../src/ai/modules/document.module';
import { employeeModule } from '../../src/ai/modules/employee.module';
import { expenseModule } from '../../src/ai/modules/expense.module';
import { exportsModule } from '../../src/ai/modules/exports.module';
import { leaveModule } from '../../src/ai/modules/leave.module';
import { myExpenseModule } from '../../src/ai/modules/myExpense.module';
import { navigationModule } from '../../src/ai/modules/navigation.module';
import { projectModule } from '../../src/ai/modules/project.module';
import { roleModule } from '../../src/ai/modules/role.module';
import { taskModule } from '../../src/ai/modules/task.module';
import { canUseModule } from '../../src/ai/registry';
import { ApiClient } from '../../src/ai/types';
import { PLAN_FEATURES, PLAN_MODULES } from '../../src/constants/modules';
import { roleRepository } from '../../src/repositories/role.repository';
import { SubscriptionState } from '../../src/services/subscription.service';
import { chatSchema } from '../../src/validators/ai.validators';
import { admin, employeeUser, FakeProjectApi, project, scriptedModel, stubPersistence, toolCall, turn, TurnOptions } from './support';

stubPersistence();

const plan = (type: 'basic' | 'professional'): SubscriptionState => ({ planType: type, billingCycle: 'monthly', expiryDate: null, active: true, modules: [...PLAN_MODULES[type]], features: [...PLAN_FEATURES[type]] });
const PRO = plan('professional');

/** Navigation calls no endpoint: any call fails the test. */
const noApi: ApiClient = {
  get: () => Promise.reject(new Error('no API call expected')),
  page: () => Promise.reject(new Error('no API call expected')),
  send: () => Promise.reject(new Error('no API call expected')),
};

/** The employee's role: reads Tasks and Documents only. */
function employeeRole(...modules: string[]) {
  jest.spyOn(roleRepository, 'findById').mockResolvedValue({
    permissions: modules.map((module) => ({ module, read: true, create: false, update: false, delete: false })),
  } as never);
}
beforeEach(() => employeeRole('tasks', 'documents'));

// No scripted replies: any model call fails the test.
const run = (opts: Partial<TurnOptions>) => turn({ api: noApi, model: scriptedModel(), subscription: PRO, ...opts });

describe('"go to" on every assistant (section 4)', () => {
  const MODULES = [employeeModule, projectModule, departmentModule, exportsModule, taskModule, documentModule, roleModule, expenseModule, leaveModule, attendanceModule, myExpenseModule, auditLogModule, navigationModule];

  it.each(MODULES.map((m) => [m.key, m]))('"Jump to dashboard" on %s opens Home with no model call', async (_key, module) => {
    const { last } = await run({ module, message: 'Jump to dashboard' });
    expect(last.result).toEqual({ text: 'Opening **Home**.', goTo: '/home' });
  });

  it.each([
    ['Go to the projects page', '/projects'],
    ['open the project module', '/projects'],
    ['Hey, take me to my leave', '/me/leave'],
    ['Switch to the summary tab', '/expenses?tab=summary'],
    ['leave types kholo', '/leave/types'],
    ['Navigate to roles', '/roles'],
  ])('an admin saying "%s" goes to %s', async (message, path) => {
    const { last } = await run({ module: employeeModule, message, page: '/employees' });
    expect(last.result!.goTo).toBe(path);
  });

  it('says so when the user is already there, by page and tab', async () => {
    expect((await run({ module: projectModule, message: 'Go to projects', page: '/projects' })).last.result).toEqual({ text: "You're already on **Projects**." });
    // No page sent: the assistant's own page.
    expect((await run({ module: projectModule, message: 'Open the projects page' })).last.result!.text).toBe("You're already on **Projects**.");
    expect((await run({ module: expenseModule, message: 'Go to the categories tab', page: '/expenses?status=paid' })).last.result!.goTo).toBe('/expenses?tab=categories');
  });

  it('leaves "show" of this page\'s own data to the module', async () => {
    const api = new FakeProjectApi([project('Apollo', '2026-12-31')]);
    const own = await turn({ module: projectModule, api, model: scriptedModel(toolCall('list_projects', {})), message: 'Show projects', page: '/projects', subscription: PRO });
    expect(own.last.result!.goTo).toBeUndefined();
    expect(own.last.result!.text).toContain('**Apollo**');
    const elsewhere = await run({ module: projectModule, message: 'Show me the dashboard', page: '/projects' });
    expect(elsewhere.last.result!.goTo).toBe('/home');
  });

  it('a page and more is a button and what to ask there; two pages are a question', async () => {
    const more = await run({ module: employeeModule, message: 'Go to projects and create Apollo', page: '/employees' });
    expect(more.last.result).toEqual({
      text: 'I can open **Projects** first. Then ask there: “create Apollo”.',
      buttons: [{ label: 'Open Projects', toolCall: { name: 'go_to_page', args: { page: 'projects' } } }],
    });
    const two = await run({ module: employeeModule, message: 'Go to projects and tasks', page: '/employees' });
    expect(two.last.result!.text).toBe('I can open one page at a time. Which one?');
    expect(two.last.result!.buttons!.map((b) => b.label)).toEqual(['Open Projects', 'Open Tasks']);
  });

  it('asks which page when a word fits several', async () => {
    const { last } = await run({ module: navigationModule, message: 'Go to attendance', page: '/home' });
    expect(last.result!.text).toBe('Which page did you mean?');
    expect(last.result!.buttons!.map((b) => b.toolCall.args.page)).toEqual(['me-attendance', 'team-attendance']);
  });

  it('says where a page is, with a button, without leaving', async () => {
    const { last } = await run({ module: navigationModule, message: 'Where do I set office hours?', page: '/home' });
    expect(last.result).toEqual({
      text: '**Attendance settings** is under **Approvals & leave** in the sidebar.',
      buttons: [{ label: 'Open Attendance settings', toolCall: { name: 'go_to_page', args: { page: 'attendance-settings' } } }],
    });
  });
});

describe('only pages the user may open (sections 5 and 6)', () => {
  it.each([
    ['Open roles', "**Roles** is only for your organization's admin, so I can't open it."],
    ['Go to admin users', "**Admin Users** is only for the platform's super admin, so I can't open it."],
    ['Go to the plans page', "**Plans** is only for the platform's super admin, so I can't open it."],
    ['Go to projects', "Your role doesn't include **Projects**, so I can't open it. Your admin can give you access."],
    ['Take me to leave approvals', "**Approvals** is only for your organization's admin, so I can't open it."],
    ['Go to the login page', "You're already signed in. To use another account, sign out from the menu under your name first."],
    ['Log out page', 'To sign out, use **Sign out** in the menu under your name, top right.'],
  ])('an employee saying "%s" is refused', async (message, text) => {
    const { last } = await run({ module: taskModule, user: employeeUser, message, page: '/tasks' });
    expect(last.result!.text).toBe(text);
    expect(last.result!.goTo).toBeUndefined();
  });

  it('opens what the role can read, and the pages every member has', async () => {
    for (const [message, path] of [['Go to tasks', '/tasks'], ['Go to documents', '/documents'], ['Jump to dashboard', '/home'], ['Go to holidays', '/me/holidays'], ['Go to expenses', '/me/expenses'], ['Open my profile', '/profile']]) {
      const { last } = await run({ module: navigationModule, user: employeeUser, message, page: '/me/team' });
      expect(last.result!.goTo).toBe(path);
    }
  });

  it('offers the pages a refused one leaves open', async () => {
    const { last } = await run({ module: navigationModule, user: employeeUser, message: 'Go to team attendance', page: '/home' });
    expect(last.result!.text).toBe("**Team attendance** is only for your organization's admin, so I can't open it.");
    expect(last.result!.buttons!.map((b) => b.label).sort()).toEqual(['Open Me → Attendance', 'Open Me → Team']);
  });

  it('follows the plan, even for an admin, and offers Billing', async () => {
    const { last } = await run({ module: navigationModule, message: 'Go to exports', page: '/home', subscription: plan('basic') });
    expect(last.result).toEqual({
      text: "Your organization's plan doesn't include **Exports**. You can change the plan on **Billing & plan**.",
      buttons: [{ label: 'Open Billing & plan', toolCall: { name: 'go_to_page', args: { page: 'billing' } } }],
    });
  });

  it('points an admin asking for Plans to Billing & plan', async () => {
    const { last } = await run({ module: navigationModule, message: 'Go to plans', page: '/home' });
    expect(last.result!.text).toBe("**Plans** is only for the platform's super admin, so I can't open it. Your organization's own plan is on **Billing & plan**.");
    expect(last.result!.buttons!.map((b) => b.label)).toEqual(['Open Billing & plan']);
  });

  it('checks a button again when it is clicked', async () => {
    const denied = await run({ module: taskModule, user: employeeUser, toolCall: { name: 'go_to_page', args: { page: 'roles' } }, page: '/tasks' });
    expect(denied.last.result!.goTo).toBeUndefined();
    expect(denied.last.result!.text).toMatch(/only for your organization's admin/);
    const allowed = await run({ module: taskModule, toolCall: { name: 'go_to_page', args: { page: 'roles' } }, page: '/tasks' });
    expect(allowed.last.result!.goTo).toBe('/roles');
  });

  it('lists the pages this user may open', async () => {
    const { last } = await run({ module: navigationModule, user: employeeUser, message: 'Which pages can I open?', page: '/home' });
    const pages = last.result!.table!.rows.map((r) => r.page);
    expect(pages).toEqual(expect.arrayContaining(['Home', 'Me → Leave', 'Tasks', 'Documents', 'Profile', 'Change password']));
    expect(pages).not.toEqual(expect.arrayContaining(['Roles']));
    expect(pages).not.toContain('Projects');
    expect(pages).not.toContain('Admin Users');
    expect(last.result!.buttons!.map((b) => b.label)).toEqual(['Home', 'Me → Leave', 'Me → Attendance', 'Me → Expenses', 'Documents', 'Tasks']);
  });
});

describe('the Navigation assistant (section 8)', () => {
  it('opens a page from its name alone, and is open to every member', async () => {
    const { last } = await run({ module: navigationModule, message: 'Projects', page: '/home' });
    expect(last.result!.goTo).toBe('/projects');
    expect(await canUseModule(navigationModule, employeeUser, PRO)).toBe(true);
    expect(await canUseModule(navigationModule, admin, PRO)).toBe(true);
  });

  it('asks the model only for wording it can not read; the model never opens a closed page', async () => {
    const model = scriptedModel(toolCall('go_to_page', { page: 'approve claims' }));
    const { last } = await run({ module: navigationModule, user: employeeUser, message: 'I need to approve some claims', page: '/home', model });
    expect(model.seen).toHaveLength(1);
    expect(last.result!.text).toBe("**Approvals → Expenses** is only for your organization's admin, so I can't open it.");
    expect(last.result!.buttons!.map((b) => b.label)).toEqual(['Open Me → Expenses']);
  });

  it("jumps on the model's pick only when the user asked to go", async () => {
    const where = await run({ module: navigationModule, message: 'I need to approve some claims', page: '/home', model: scriptedModel(toolCall('go_to_page', { page: 'expense approvals' })) });
    expect(where.last.result!.goTo).toBeUndefined();
    expect(where.last.result!.buttons!.map((b) => b.label)).toEqual(['Open Approvals → Expenses']);
    const go = await run({ module: navigationModule, message: 'Take me to where I approve claims', page: '/home', model: scriptedModel(toolCall('go_to_page', { page: 'expense approvals' })) });
    expect(go.last.result!.goTo).toBe('/leave/approvals?tab=expenses');
  });

  it("says so when the model's page doesn't exist", async () => {
    const { last } = await run({ module: navigationModule, message: 'I want payroll', page: '/home', model: scriptedModel(toolCall('go_to_page', { page: 'payroll' })) });
    expect(last.result!.text).toBe('I couldn\'t find a page called “payroll”. Say “Where can I go?” to see the pages you can open.');
  });

  it("never opens a page the model guessed but the user's words don't name", async () => {
    // In the eval, llama3.2 answered "Open payroll" with Expenses.
    const { last } = await run({ module: navigationModule, message: 'Open payroll', page: '/home', model: scriptedModel(toolCall('go_to_page', { page: 'Expenses' })) });
    expect(last.result).toEqual({
      text: 'I think you mean **Expenses → Claims**, in the sidebar.',
      buttons: [{ label: 'Open Expenses → Claims', toolCall: { name: 'go_to_page', args: { page: 'expenses' } } }],
    });
  });
});

describe('the chat request (section 10)', () => {
  it('takes the current page only as a path in the app', () => {
    expect(chatSchema.safeParse({ module: 'navigation', message: 'Go to tasks', page: '/expenses?tab=summary' }).success).toBe(true);
    expect(chatSchema.safeParse({ module: 'navigation', message: 'Go to tasks', page: '//evil.example' }).success).toBe(false);
    expect(chatSchema.safeParse({ module: 'navigation', message: 'Go to tasks', page: 'https://evil.example' }).success).toBe(false);
  });
});
