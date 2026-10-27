import { confirmAction } from '../../src/ai/agent.service';
import { roleModule } from '../../src/ai/modules/role.module';
import { allowedTools, canUseModule } from '../../src/ai/registry';
import { PLAN_MODULES } from '../../src/constants/modules';
import { admin, employeeUser, FakeRoleApi, role, scriptedModel, stubPersistence, toolCall, turn, TurnOptions } from './support';

stubPersistence();

const run = (opts: TurnOptions) => turn({ module: roleModule, ...opts });
const hrManager = () => role('HR Manager', { employees: 'RCU', documents: 'RCUD', projects: 'R' });

describe('create_role', () => {
  it('reads the permissions from one sentence and creates on Confirm (4.1)', async () => {
    const api = new FakeRoleApi();
    const { last } = await run({
      api,
      message: 'Create a role HR Manager with read, create and update on employees, select all on documents and read on projects',
      // The model's own copy of the permissions is wrong: the message's words are read instead.
      model: scriptedModel(toolCall('create_role', { name: 'HR Manager', permissions: 'all permissions' })),
    });
    const card = last.action!.card;
    expect(card.rows).toEqual([
      { label: 'Name', value: 'HR Manager' },
      { label: 'Employees', value: 'Read, Create, Update' },
      { label: 'Documents', value: 'all' },
      { label: 'Projects', value: 'Read' },
    ]);
    expect(card.form).toMatchObject({ kind: 'role', mode: 'create' });
    expect(api.writes()).toEqual([]);

    const done = await confirmAction({ user: admin, token: 't', actionId: last.action!.id, api });
    expect(api.writes()).toEqual([
      {
        method: 'POST',
        path: '/roles',
        body: {
          name: 'HR Manager',
          permissions: [
            { module: 'employees', read: true, create: true, update: true, delete: false },
            { module: 'documents', read: true, create: true, update: true, delete: true },
            { module: 'projects', read: true, create: false, update: false, delete: false },
          ],
        },
      },
    ]);
    expect(done.message.result!.text).toBe('✅ **Role created:** HR Manager · Employees: Read, Create, Update · Documents: all · Projects: Read.');
  });

  it('gives "all permissions" for the modules of the plan only (4.2)', async () => {
    const api = new FakeRoleApi([], [...PLAN_MODULES.basic]);
    const { last } = await run({ api, message: 'Create a role Auditor with all permissions', model: scriptedModel(toolCall('create_role', { name: 'Auditor' })) });
    expect(last.action!.card.rows.map((r) => r.label)).toEqual(['Name', 'Dashboard', 'Employees', 'Documents', 'Projects', 'Tasks', 'Departments']);
    expect(last.action!.card.rows.slice(1).every((r) => r.value === 'all')).toBe(true);
  });

  it('notes Read added where it was needed', async () => {
    const api = new FakeRoleApi();
    const { last } = await run({ api, message: 'Create a role Writer with create and update on tasks', model: scriptedModel(toolCall('create_role', { name: 'Writer' })) });
    expect(last.action!.card.rows[1]).toEqual({ label: 'Tasks', value: 'Read, Create, Update' });
    expect(last.action!.card.notes).toEqual(['Read is added for Tasks: Create, Update and Delete need it.']);
  });

  it('asks for the name and permissions, then takes a plain reply without the model', async () => {
    const api = new FakeRoleApi();
    const first = await run({ api, message: 'Create a new role', model: scriptedModel(toolCall('create_role', {})) });
    expect(first.last.result!.text).toBe(
      "I'll create a new role. I still need the **name** and its **permissions** (which modules, and Read, Create, Update or Delete)."
    );
    expect(first.last.result!.buttons![0].label).toBe('Fill in the form instead');

    const second = await run({ api, conversationId: first.conversationId, message: 'Support Agent with read and update on tasks', model: scriptedModel() });
    expect(second.last.action!.card.rows).toEqual([
      { label: 'Name', value: 'Support Agent' },
      { label: 'Tasks', value: 'Read, Update' },
    ]);
  });

  it('asks for the permissions only, and reads the reply as them', async () => {
    const api = new FakeRoleApi();
    const first = await run({ api, message: 'Create a role called Intern', model: scriptedModel(toolCall('create_role', { name: 'Intern' })) });
    expect(first.last.result!.text).toMatch(/^I'll create the role \*\*Intern\*\*\. I still need its \*\*permissions\*\*/);
    const second = await run({ api, conversationId: first.conversationId, message: 'read on employees and projects', model: scriptedModel() });
    expect(second.last.action!.card.rows).toEqual([
      { label: 'Name', value: 'Intern' },
      { label: 'Employees', value: 'Read' },
      { label: 'Projects', value: 'Read' },
    ]);
  });

  it('asks which modules for an action with none, and completes it from the reply', async () => {
    const api = new FakeRoleApi();
    const first = await run({ api, message: 'Create a role Viewer with read only', model: scriptedModel(toolCall('create_role', { name: 'Viewer', permissions: 'read only' })) });
    expect(first.last.result!.text).toBe('For **Viewer**: Which modules should get Read? Name them, or say "all modules".');
    const second = await run({ api, conversationId: first.conversationId, message: 'Employees and documents', model: scriptedModel() });
    expect(second.last.action!.card.rows).toEqual([
      { label: 'Name', value: 'Viewer' },
      { label: 'Employees', value: 'Read' },
      { label: 'Documents', value: 'Read' },
    ]);
  });

  it('drops a name made of permission words, and warns about a name in use', async () => {
    const api = new FakeRoleApi([hrManager()]);
    const odd = await run({ api, message: 'Create a role with read access', model: scriptedModel(toolCall('create_role', { name: 'Read access' })) });
    expect(odd.last.result!.text).toMatch(/I still need the \*\*name\*\*/);

    const same = await run({ api, message: 'Create a role hr manager with read on tasks', model: scriptedModel(toolCall('create_role', { name: 'hr manager' })) });
    expect(same.last.action!.card.warnings).toEqual(['A role called "HR Manager" already exists.']);
  });

  it('saves the form as edited on the card', async () => {
    const api = new FakeRoleApi();
    const { last } = await run({ api, toolCall: { name: 'create_role', args: {}, form: true } });
    expect(last.action!.card.incomplete).toBe(true);
    await confirmAction({
      user: admin,
      token: 't',
      actionId: last.action!.id,
      api,
      values: {
        name: ' Recruiter ',
        permissions: [
          { module: 'employees', read: true, create: true, update: false, delete: false },
          { module: 'tasks', read: false, create: false, update: false, delete: false },
        ],
      },
    });
    expect(api.writes()[0].body).toEqual({ name: 'Recruiter', permissions: [{ module: 'employees', read: true, create: true, update: false, delete: false }] });
  });
});

describe('update_role', () => {
  it('sets only the modules named, showing old → new (4.3)', async () => {
    const hr = hrManager();
    const api = new FakeRoleApi([hr]);
    const { last } = await run({
      api,
      message: 'Update the HR Manager role with read and update on tasks',
      model: scriptedModel(toolCall('update_role', { role: 'HR Manager', permissions: 'read and update on tasks' })),
    });
    expect(last.action!.card.title).toBe('Update HR Manager');
    expect(last.action!.card.rows).toEqual([{ label: 'Tasks', value: 'Read, Update', previous: '—' }]);
    await confirmAction({ user: admin, token: 't', actionId: last.action!.id, api });
    expect((api.writes()[0].body as { permissions: { module: string }[] }).permissions.map((p) => p.module)).toEqual(['employees', 'documents', 'projects', 'tasks']);
  });

  it('gives, takes away and clears a module', async () => {
    const hr = hrManager();
    const api = new FakeRoleApi([hr]);
    const give = await run({ api, message: 'Give delete on employees to HR Manager', model: scriptedModel(toolCall('update_role', { role: 'HR Manager' })) });
    expect(give.last.action!.card.rows).toEqual([{ label: 'Employees', value: 'all', previous: 'Read, Create, Update' }]);

    const remove = await run({ api, message: 'Remove create from documents for HR Manager', model: scriptedModel(toolCall('update_role', { role: 'HR Manager' })) });
    expect(remove.last.action!.card.rows).toEqual([{ label: 'Documents', value: 'Read, Update, Delete', previous: 'all' }]);

    const clear = await run({ api, message: 'Take away projects from HR Manager', model: scriptedModel(toolCall('update_role', { role: 'HR Manager' })) });
    expect(clear.last.action!.card.rows).toEqual([{ label: 'Projects', value: '—', previous: 'Read' }]);
  });

  it('renames a role, and only when asked to', async () => {
    const api = new FakeRoleApi([hrManager()]);
    const { last } = await run({ api, message: 'Rename HR Manager to People Manager', model: scriptedModel(toolCall('update_role', { role: 'HR Manager', newName: 'People Manager' })) });
    expect(last.action!.card.rows).toEqual([{ label: 'Name', value: 'People Manager', previous: 'HR Manager' }]);
    await confirmAction({ user: admin, token: 't', actionId: last.action!.id, api });
    expect(api.writes()[0].body).toEqual({ name: 'People Manager' });

    const invented = await run({ api, message: 'Give read on tasks to People Manager', model: scriptedModel(toolCall('update_role', { role: 'People Manager', newName: 'Tasks Reader' })) });
    expect(invented.last.action!.card.rows).toEqual([{ label: 'Tasks', value: 'Read', previous: '—' }]);
  });

  it("reads the model's newName as the role when no rename was asked for", async () => {
    const api = new FakeRoleApi([hrManager()]);
    const { last } = await run({
      api,
      message: 'Remove create from documents for HR Manager',
      model: scriptedModel(toolCall('update_role', { newName: 'HR Manager', permissions: 'remove create' })),
    });
    expect(last.action!.card.title).toBe('Update HR Manager');
    expect(last.action!.card.rows).toEqual([{ label: 'Documents', value: 'Read, Update, Delete', previous: 'all' }]);
  });

  it('says so when the role already has what was asked', async () => {
    const api = new FakeRoleApi([hrManager()]);
    const { last } = await run({ api, message: 'Give read on projects to HR Manager', model: scriptedModel(toolCall('update_role', { role: 'HR Manager' })) });
    expect(last.result!.text).toBe('**HR Manager** already has that: Employees: Read, Create, Update · Documents: all · Projects: Read.');
  });

  it('goes to update when the model called create for an existing role', async () => {
    const api = new FakeRoleApi([hrManager()]);
    const { last } = await run({ api, message: 'Give delete on employees to HR Manager', model: scriptedModel(toolCall('create_role', { name: 'HR Manager' })) });
    expect(last.action!.card.title).toBe('Update HR Manager');
    expect(last.action!.card.rows).toEqual([{ label: 'Employees', value: 'all', previous: 'Read, Create, Update' }]);
  });

  it('reads a change said outright without the model', async () => {
    const api = new FakeRoleApi([role('Auditor', { auditLogs: 'R' })], [...PLAN_MODULES.basic]);
    // No scripted replies: any model call fails the test.
    const { last } = await run({ api, message: 'Select all permissions for the Auditor role', model: scriptedModel() });
    expect(last.action!.card.title).toBe('Update Auditor');
    expect(last.action!.card.rows.map((r) => `${r.label}: ${r.value}`)).toEqual([
      'Dashboard: all',
      'Employees: all',
      'Documents: all',
      'Projects: all',
      'Tasks: all',
      'Departments: all',
    ]);
  });
});

describe('delete_role', () => {
  it('shows a red card and deletes on Confirm (4.4)', async () => {
    const auditor = role('Auditor', { auditLogs: 'R' });
    const api = new FakeRoleApi([auditor, hrManager()]);
    const { last } = await run({ api, message: 'Delete the Auditor role', model: scriptedModel(toolCall('delete_role', { role: 'Auditor' })) });
    expect(last.action!.card).toMatchObject({ title: 'Delete Auditor?', tone: 'danger', rows: [{ label: 'Permissions', value: 'Audit Logs: Read' }], confirmLabel: 'Delete role' });
    const done = await confirmAction({ user: admin, token: 't', actionId: last.action!.id, api });
    expect(api.writes()).toEqual([{ method: 'DELETE', path: `/roles/${auditor.id}` }]);
    expect(done.message.result!.text).toBe('✅ **Auditor** was deleted.');
  });

  it('refuses before the card while employees have the role', async () => {
    const hr = hrManager();
    const api = new FakeRoleApi([hr]);
    api.holders.set(hr.id, 4);
    const { last } = await run({ api, message: 'Delete the HR Manager role', model: scriptedModel(toolCall('delete_role', { role: 'HR Manager' })) });
    expect(last.action).toBeNull();
    expect(last.result!.text).toBe("**HR Manager** is given to 4 employees, so it can't be deleted. Give them another role first, on the Employees page.");
  });

  it('says so when no role has that name', async () => {
    const api = new FakeRoleApi([hrManager()]);
    const { last } = await run({ api, message: 'Delete the Intern role', model: scriptedModel(toolCall('delete_role', { role: 'Intern' })) });
    expect(last.result!.text).toBe('There is no role called "Intern". Roles: HR Manager.');
  });

  it('goes to update for a delete that names permissions', async () => {
    const api = new FakeRoleApi([role('HR Manager', { tasks: 'RCUD' })]);
    const { last } = await run({ api, message: 'Remove delete on tasks from HR Manager', model: scriptedModel(toolCall('delete_role', { role: 'HR Manager' })) });
    expect(last.action!.card.title).toBe('Update HR Manager');
    expect(last.action!.card.rows).toEqual([{ label: 'Tasks', value: 'Read, Create, Update', previous: 'all' }]);
    expect(api.writes()).toEqual([]);
  });
});

describe('list_roles', () => {
  it('lists roles with their permissions and employees', async () => {
    const hr = hrManager();
    const api = new FakeRoleApi([hr, role('Auditor', { auditLogs: 'R' })]);
    api.holders.set(hr.id, 3);
    const { last } = await run({ api, toolCall: { name: 'list_roles', args: {} } });
    expect(last.result!.text).toBe('**2 roles**.');
    expect(last.result!.table!.rows).toEqual([
      { name: 'Auditor', employees: '0', permissions: 'Audit Logs: Read' },
      { name: 'HR Manager', employees: '3', permissions: 'Employees: Read, Create, Update · Documents: all · Projects: Read' },
    ]);
  });

  it("answers one role's permissions as a line", async () => {
    const api = new FakeRoleApi([hrManager(), role('Auditor')]);
    const { last } = await run({ api, message: 'What can HR Manager do?', model: scriptedModel(toolCall('list_roles', { search: 'HR Manager' })) });
    expect(last.result!.text).toBe('**HR Manager** · 0 employees · Employees: Read, Create, Update · Documents: all · Projects: Read');
  });
});

describe('list_roles, continued', () => {
  it('answers about the one role the message names when the model sends no search', async () => {
    const api = new FakeRoleApi([hrManager(), role('Auditor')]);
    const { last } = await run({ api, message: 'What can HR Manager do?', model: scriptedModel(toolCall('list_roles', { search: '' })) });
    expect(last.result!.text).toMatch(/^\*\*HR Manager\*\* · /);
  });
});

describe('who can use it', () => {
  it('is for ORG_ADMIN only', async () => {
    expect(await canUseModule(roleModule, admin)).toBe(true);
    expect(await canUseModule(roleModule, employeeUser)).toBe(false);
    expect((await allowedTools(roleModule, admin)).map((t) => t.name)).toEqual(['list_roles', 'create_role', 'update_role', 'delete_role']);
  });
});
