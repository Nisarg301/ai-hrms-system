import { confirmAction } from '../../src/ai/agent.service';
import { departmentModule } from '../../src/ai/modules/department.module';
import { allowedTools } from '../../src/ai/registry';
import { admin, department, employeeUser, FakeDepartmentApi, scriptedModel, stubPersistence, toolCall, turn, TurnOptions } from './support';

stubPersistence();

const run = (opts: TurnOptions) => turn({ module: departmentModule, ...opts });

describe('create_department', () => {
  it('asks for the missing description, takes the reply without the model, and creates on Confirm (4.1)', async () => {
    const api = new FakeDepartmentApi();
    const first = await run({
      api,
      message: 'Create a department called Design',
      model: scriptedModel(toolCall('create_department', { name: 'Design', description: '' })),
    });
    expect(first.last.result!.text).toBe("I'll create Design. I still need a short **description**.");

    // The only missing thing was the description: the reply is taken as it, with no model call.
    const second = await run({ api, conversationId: first.conversationId, message: 'Product and brand design', model: scriptedModel() });
    expect(second.last.action!.card.rows).toEqual([
      { label: 'Title', value: 'Design' },
      { label: 'Description', value: 'Product and brand design' },
      { label: 'Status', value: 'Active' },
    ]);
    expect(api.writes()).toEqual([]);

    const done = await confirmAction({ user: admin, token: 't', actionId: second.last.action!.id, api });
    expect(api.writes()).toEqual([{ method: 'POST', path: '/departments', body: { title: 'Design', description: 'Product and brand design', status: 'active' } }]);
    expect(done.message.result!.text).toBe('✅ **Department created:** Design · Active.');
  });

  it('answers a "thanks" itself and keeps the draft for the next reply', async () => {
    const api = new FakeDepartmentApi();
    const first = await run({ api, message: 'Create a department called Design', model: scriptedModel(toolCall('create_department', { name: 'Design' })) });
    const thanks = await run({ api, conversationId: first.conversationId, message: 'Thanks', model: scriptedModel() });
    expect(thanks.last.result).toEqual({ text: "You're welcome!" });
    const third = await run({ api, conversationId: first.conversationId, message: 'Product and brand design', model: scriptedModel() });
    expect(third.last.action!.card.rows.find((r) => r.label === 'Description')!.value).toBe('Product and brand design');
  });

  it('keeps Active when the model invents a status, and takes one the user said', async () => {
    const api = new FakeDepartmentApi();
    const invented = await run({
      api,
      message: 'New department Legal, contracts and compliance',
      model: scriptedModel(toolCall('create_department', { name: 'Legal', description: 'contracts and compliance', status: 'inactive' })),
    });
    expect(invented.last.action!.card.rows.find((r) => r.label === 'Status')!.value).toBe('Active');

    const said = await run({
      api,
      message: 'New department Legal, contracts and compliance, inactive for now',
      model: scriptedModel(toolCall('create_department', { name: 'Legal', description: 'contracts and compliance', status: 'inactive' })),
    });
    expect(said.last.action!.card.rows.find((r) => r.label === 'Status')!.value).toBe('Inactive');
  });

  it('warns about a department with the same title', async () => {
    const api = new FakeDepartmentApi([department('Design')]);
    const { last } = await run({
      api,
      message: 'Create a department called design for the brand team',
      model: scriptedModel(toolCall('create_department', { name: 'design', description: 'brand team' })),
    });
    expect(last.action!.card.warnings).toEqual(['A department called "Design" already exists.']);
  });
});

describe('update_department', () => {
  it('renames a department found by its initials, showing old → new (4.2)', async () => {
    const hr = department('Human Resources');
    const api = new FakeDepartmentApi([hr, department('Engineering')]);
    const { last } = await run({
      api,
      message: 'Rename HR to People Operations',
      model: scriptedModel(toolCall('update_department', { department: 'HR', newName: 'People Operations' })),
    });
    expect(last.action!.card.title).toBe('Update Human Resources');
    expect(last.action!.card.rows).toEqual([{ label: 'Title', value: 'People Operations', previous: 'Human Resources' }]);
    const done = await confirmAction({ user: admin, token: 't', actionId: last.action!.id, api });
    expect(api.writes()).toEqual([{ method: 'PUT', path: `/departments/${hr.id}`, body: { title: 'People Operations' } }]);
    expect(done.message.result!.text).toBe('✅ Updated **People Operations**: title is now People Operations.');
  });

  it('deactivates from the message alone, and warns that employees stay in it', async () => {
    const sales = department('Sales');
    const api = new FakeDepartmentApi([sales]);
    api.employeesByDepartment.set(sales.id, 4);
    // The model dropped the status; "Deactivate" in the message still counts.
    const { last } = await run({ api, message: 'Deactivate Sales', model: scriptedModel(toolCall('update_department', { name: 'Sales' })) });
    expect(last.action!.card.rows).toEqual([{ label: 'Status', value: 'Inactive', previous: 'Active' }]);
    expect(last.action!.card.warnings).toEqual(["4 employees are still in Sales. Deactivating doesn't move them."]);
  });

  it("doesn't read a status word in the department's own name as a change", async () => {
    const api = new FakeDepartmentApi([department('Archive')]);
    const { last } = await run({ api, message: 'Update Archive', model: scriptedModel(toolCall('update_department', { department: 'Archive', status: 'inactive' })) });
    expect(last.result!.text).toBe('Nothing to change for **Archive**. Tell me what to change: name, description or status.');
  });

  it('asks which one when several match, and keeps the checked change through the button', async () => {
    const api = new FakeDepartmentApi([department('Sales North'), department('Sales South')]);
    const first = await run({ api, message: 'Deactivate Sales', model: scriptedModel(toolCall('update_department', { department: 'Sales', status: 'deactivate' })) });
    expect(first.last.result!.text).toBe('2 departments match "Sales". Which one?');
    const button = first.last.result!.buttons![1];
    expect(button.label).toBe('Sales South · Active · Sales South team');
    expect(button.toolCall.args).toMatchObject({ status: 'inactive' });

    const second = await run({ api, conversationId: first.conversationId, toolCall: button.toolCall });
    expect(second.last.action!.card.title).toBe('Update Sales South');
    expect(second.last.action!.card.rows).toEqual([{ label: 'Status', value: 'Inactive', previous: 'Active' }]);
  });

  it('lists the real departments when none matches', async () => {
    const api = new FakeDepartmentApi([department('Engineering'), department('Sales')]);
    const { last } = await run({ api, message: 'Rename Finance to Accounts', model: scriptedModel(toolCall('update_department', { department: 'Finance', newName: 'Accounts' })) });
    expect(last.result!.text).toBe('There is no department called "Finance". Departments: Engineering and Sales.');
  });
});

describe('delete_department', () => {
  it('refuses while employees are in it, and offers to deactivate instead (4.4)', async () => {
    const eng = department('Engineering');
    const api = new FakeDepartmentApi([eng]);
    api.employeesByDepartment.set(eng.id, 12);
    const first = await run({ api, message: 'Delete Engineering', model: scriptedModel(toolCall('delete_department', { department: 'Engineering' })) });
    expect(first.last.action).toBeNull();
    expect(first.last.result!.text).toBe("**Engineering** still has 12 employees, so it can't be deleted. Move them to another department first, on the Employees page.");

    const second = await run({ api, conversationId: first.conversationId, toolCall: first.last.result!.buttons![0].toolCall });
    expect(second.last.action!.card.rows).toEqual([{ label: 'Status', value: 'Inactive', previous: 'Active' }]);
    expect(api.writes()).toEqual([]);
  });

  it('deletes an empty department after a red card', async () => {
    const design = department('Design');
    const api = new FakeDepartmentApi([design]);
    const { last } = await run({ api, message: 'Delete the Design department', model: scriptedModel(toolCall('delete_department', { department: 'Design department' })) });
    expect(last.action!.card).toMatchObject({ title: 'Delete Design?', tone: 'danger', confirmLabel: 'Delete department' });
    const done = await confirmAction({ user: admin, token: 't', actionId: last.action!.id, api });
    expect(api.writes()).toEqual([{ method: 'DELETE', path: `/departments/${design.id}` }]);
    expect(done.message.result!.text).toBe('✅ **Design** was deleted.');
  });
});

describe('reads', () => {
  it('lists departments with their employee counts (4.3)', async () => {
    const eng = department('Engineering');
    const sales = department('Sales', 'inactive');
    const api = new FakeDepartmentApi([sales, eng]);
    api.employeesByDepartment.set(eng.id, 12);
    // "all" is not a status filter.
    const { last } = await run({ api, toolCall: { name: 'list_departments', args: { status: 'all' } } });
    expect(last.result!.text).toBe('**2 departments**.');
    expect(last.result!.table!.columns.map((c) => c.title)).toEqual(['Department', 'Status', 'Employees', 'Description']);
    expect(last.result!.table!.rows).toEqual([
      { title: 'Engineering', status: 'Active', employees: '12', description: 'Engineering team' },
      { title: 'Sales', status: 'Inactive', employees: '0', description: 'Sales team' },
    ]);
  });

  it('leaves out employee counts when the user may not read employees', async () => {
    const api = new FakeDepartmentApi([department('Engineering'), department('Sales')]);
    api.employeesForbidden = true;
    const { last } = await run({ user: employeeUser, api, toolCall: { name: 'list_departments', args: {} } });
    expect(last.result!.table!.columns.map((c) => c.title)).toEqual(['Department', 'Status', 'Description']);
  });

  it('answers "how many people work in Engineering?" with the details line', async () => {
    const eng = department('Engineering', 'active', 'Builds the product');
    const api = new FakeDepartmentApi([eng, department('Engineering Support')]);
    api.employeesByDepartment.set(eng.id, 12);
    const { last } = await run({
      api,
      message: 'How many people work in Engineering?',
      model: scriptedModel(toolCall('list_departments', { search: 'Engineering' })),
    });
    expect(last.result!.text).toBe('**Engineering** · Active · 12 employees · Builds the product');
  });

  it('counts by status, and the employees of one department', async () => {
    const eng = department('Engineering');
    const api = new FakeDepartmentApi([eng, department('Sales'), department('Legal', 'inactive')]);
    api.employeesByDepartment.set(eng.id, 1);
    const all = await run({ api, toolCall: { name: 'count_departments', args: {} } });
    expect(all.last.result!.text).toBe('**3 departments**: 2 active and 1 inactive.');
    const inactive = await run({ api, toolCall: { name: 'count_departments', args: { status: 'inactive' } } });
    expect(inactive.last.result!.text).toBe('**1 inactive department**.');
    const people = await run({ api, toolCall: { name: 'count_departments', args: { department: 'Engineering' } } });
    expect(people.last.result!.text).toBe('**1 employee** works in Engineering.');
  });

  it('answers a headcount question sent to count_departments with the employees per department', async () => {
    const eng = department('Engineering');
    const api = new FakeDepartmentApi([eng, department('Sales')]);
    api.employeesByDepartment.set(eng.id, 12);
    // Verbatim from the eval.
    const { last } = await run({ api, message: 'Headcount by department', model: scriptedModel(toolCall('count_departments', { status: '', department: '' })) });
    expect(last.result!.table!.rows.map((r) => [r.title, r.employees])).toEqual([
      ['Engineering', '12'],
      ['Sales', '0'],
    ]);
  });

  it('explains an unknown status instead of guessing', async () => {
    const api = new FakeDepartmentApi();
    const { last } = await run({ api, toolCall: { name: 'list_departments', args: { status: 'purple' } } });
    expect(last.result!.text).toBe('"purple" isn\'t a department status. Use Active or Inactive.');
  });
});

describe('who can do what', () => {
  it('gives an ORG_USER only the read tools, and refuses a write', async () => {
    expect((await allowedTools(departmentModule, employeeUser)).map((t) => t.name)).toEqual(['list_departments', 'count_departments']);
    const api = new FakeDepartmentApi();
    const { last } = await run({ user: employeeUser, api, toolCall: { name: 'create_department', args: {}, form: true } });
    expect(last.result!.text).toBe('That action is not available to you.');
    expect(api.writes()).toEqual([]);
  });

  it('only tells the model about writes when the user has them', () => {
    const prompt = (tools: string[]) => departmentModule.systemPrompt({ userName: 'Priya', role: 'ORG_USER', today: '2026-10-19', weekday: 'Monday', tools });
    expect(prompt(['list_departments', 'count_departments'])).not.toContain('update_department');
    expect(prompt(['list_departments', 'update_department'])).toContain('call update_department');
  });
});
