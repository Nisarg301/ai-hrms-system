import { confirmAction } from '../../src/ai/agent.service';
import { employeeModule } from '../../src/ai/modules/employee.module';
import { allowedTools, modelToolsFor } from '../../src/ai/registry';
import { admin, D_ENG, D_HR, employeeUser, FakeApi, R_EMP, row, scriptedModel, stored, stubPersistence, toolCall, turn } from './support';

stubPersistence();

describe('create_employee', () => {
  it('asks for what is missing, merges the answer, and creates only on Confirm (5.1)', async () => {
    const api = new FakeApi();
    const first = await turn({
      api,
      message: 'Create an employee named Mike Johnson in Engineering.',
      model: scriptedModel(toolCall('create_employee', { name: 'Mike Johnson', department: 'Engineering', email: '', jobTitle: '' })),
    });
    expect(first.last.result!.text).toBe("I'll create Mike Johnson in Engineering. I still need the **email address**, **job title** and **access role** (Employee or Manager).");
    expect(first.last.result!.buttons![0].label).toBe('Fill in the form instead');

    // The model drops the name this time; the saved draft keeps it.
    const second = await turn({
      api,
      conversationId: first.conversationId,
      message: 'mike@company.com, he is a Software Engineer, role Employee',
      model: scriptedModel(toolCall('create_employee', { email: 'mike@company.com', jobTitle: 'Software Engineer', role: 'Employee' })),
    });
    const card = second.last.action!.card;
    expect(card.rows.slice(0, 5)).toEqual([
      { label: 'Name', value: 'Mike Johnson' },
      { label: 'Email', value: 'mike@company.com' },
      { label: 'Job title', value: 'Software Engineer' },
      { label: 'Department', value: 'Engineering' },
      { label: 'Role', value: 'Employee' },
    ]);
    expect(api.writes()).toEqual([]);

    const confirmed = await confirmAction({ user: admin, token: 'token', actionId: second.last.action!.id, api });
    expect(api.writes()).toEqual([
      { method: 'POST', path: '/employees', body: { name: 'Mike Johnson', email: 'mike@company.com', jobTitle: 'Software Engineer', department: D_ENG, roleId: R_EMP, reportsTo: null } },
    ]);
    expect(confirmed.message.result!.text).toBe('✅ **Employee created:** Mike Johnson · Engineering · mike@company.com.');
    expect(confirmed.secrets).toEqual([{ label: 'Temporary password', value: 'Temp#Secret123' }]);
    // The temporary password reaches the browser once and is never stored.
    expect(JSON.stringify(stored.get(first.conversationId)!.toObject())).not.toContain('Temp#Secret123');
  });

  it('fills an email-only reply without calling the model', async () => {
    const api = new FakeApi();
    const first = await turn({
      api,
      message: 'Add Mike Johnson as a Software Engineer in Engineering, role Employee',
      model: scriptedModel(toolCall('create_employee', { name: 'Mike Johnson', jobTitle: 'Software Engineer', department: 'Engineering', role: 'Employee' })),
    });
    expect(first.last.result!.text).toContain('I still need the **email address**');
    const second = await turn({ api, conversationId: first.conversationId, message: 'mike@company.com', model: scriptedModel() });
    expect(second.last.action!.card.title).toBe('New employee');
  });

  it('does not save a salary, and asks for the real job title (5.2)', async () => {
    const api = new FakeApi();
    const said = 'Create an employee named Mike Johnson, email mike@company.com, department Engineering, and salary 75,000.';
    const { last } = await turn({
      api,
      message: said,
      model: scriptedModel(toolCall('create_employee', { name: 'Mike Johnson', email: 'mike@company.com', department: 'Engineering', jobTitle: 'salary 75,000' })),
    });
    expect(last.result!.text).toContain('I still need the **job title**');
    expect(last.result!.warnings).toEqual(['Not saved: salary. The employee record has no field for it.']);
  });

  it('uses another employee as a template (5.8)', async () => {
    const api = new FakeApi([row('Mike Johnson', 'mike@company.com')]);
    const { last } = await turn({ api, message: 'Create an employee from Mike', model: scriptedModel(toolCall('create_employee', { copyFrom: 'Mike' })) });
    expect(last.result!.text).toBe(
      "I'll copy Mike Johnson's department (Engineering), job title (Software Engineer) and role (Employee). What are the new employee's **name** and **email address**?"
    );
  });

  it('re-checks values edited on the card before saving', async () => {
    const api = new FakeApi();
    const { last } = await turn({ api, toolCall: { name: 'create_employee', args: {}, form: true } });
    expect(last.action!.card.incomplete).toBe(true);
    const values = { ...last.action!.card.form!.values, name: 'Sara Khan', email: 'not-an-email', jobTitle: 'QA', department: D_HR, roleId: R_EMP };
    await expect(confirmAction({ user: admin, token: 'token', actionId: last.action!.id, values, api })).rejects.toMatchObject({ statusCode: 400 });
    expect(api.writes()).toEqual([]);
    await confirmAction({ user: admin, token: 'token', actionId: last.action!.id, values: { ...values, email: 'sara@company.com' }, api });
    expect(api.writes()[0]).toMatchObject({ method: 'POST', body: { name: 'Sara Khan', email: 'sara@company.com', department: D_HR } });
  });
});

describe('update_employee and delete_employee', () => {
  it('asks which Mike, then shows old → new and saves only the change (5.5)', async () => {
    const johnson = row('Mike Johnson', 'mike@company.com');
    const api = new FakeApi([johnson, row('Mike Ross', 'mike.ross@company.com')]);
    const first = await turn({ api, message: "Change Mike's department to HR", model: scriptedModel(toolCall('update_employee', { employee: 'Mike', department: 'HR' })) });
    expect(first.last.result!.text).toBe('2 employees match "Mike". Which one?');
    const button = first.last.result!.buttons!.find((b) => b.label.startsWith('Mike Johnson'))!;

    const second = await turn({ api, conversationId: first.conversationId, toolCall: button.toolCall });
    expect(second.last.action!.card.rows).toEqual([{ label: 'Department', value: 'HR', previous: 'Engineering' }]);
    const done = await confirmAction({ user: admin, token: 'token', actionId: second.last.action!.id, api });
    expect(api.writes()).toEqual([{ method: 'PUT', path: `/employees/${johnson.id}`, body: { department: D_HR } }]);
    expect(done.message.result!.text).toBe('✅ Updated **Mike Johnson**: department is now HR.');
  });

  it('refuses to delete someone with direct reports, otherwise shows a red card', async () => {
    const lead = row('Anita Rao', 'anita@company.com');
    const mike = row('Mike Johnson', 'mike@company.com');
    const api = new FakeApi([lead, mike]);
    api.directReports.set(lead.id, [{ id: mike.id, name: 'Mike Johnson' }]);

    const refused = await turn({ api, message: 'Delete Anita', model: scriptedModel(toolCall('delete_employee', { employee: 'Anita' })) });
    expect(refused.last.result!.text).toContain('still has someone reporting to them (Mike Johnson)');
    expect(refused.last.action).toBeNull();

    const { last } = await turn({ api, message: 'Delete Mike', model: scriptedModel(toolCall('delete_employee', { employee: 'Mike' })) });
    expect(last.action!.card.tone).toBe('danger');
    expect(api.writes()).toEqual([]);
    await confirmAction({ user: admin, token: 'token', actionId: last.action!.id, api });
    expect(api.writes()).toEqual([{ method: 'DELETE', path: `/employees/${mike.id}` }]);
  });
});

describe('tool calls written as text', () => {
  it('uses a tool call the model wrote out as JSON, without showing the JSON', async () => {
    const api = new FakeApi([row('Mike Johnson', 'mike@company.com')]);
    const model = scriptedModel({ content: '{"name": "delete_employee", "parameters": {"employee": "Mike"}}', toolCalls: [] });
    const { last, events } = await turn({ api, message: 'Delete Mike', model });
    expect(last.action!.card.title).toBe('Remove Mike Johnson?');
    expect(events.filter((e) => e.type === 'token')).toEqual([]);
  });

  it('never passes on a text answer that claims a change', async () => {
    const api = new FakeApi([row('Rahul Verma', 'rahul@company.com')]);
    const model = scriptedModel({ content: 'Employee Rahul ko HR department mein shamil kiya gaya hai.', toolCalls: [] });
    const { last } = await turn({ api, message: 'Rahul ko HR mein daal do', model });
    expect(last.result!.text).toMatch(/^I didn't change anything/);
    expect(api.writes()).toEqual([]);
  });

  it('asks the model once more after broken JSON', async () => {
    const api = new FakeApi([row('Mike Johnson', 'mike@company.com')]);
    const model = scriptedModel({ content: '{"name":"update_employee","parameters{"}}', toolCalls: [] }, toolCall('update_employee', { employee: 'Mike', department: 'HR' }));
    const { last } = await turn({ api, message: "Change Mike's department to HR", model });
    expect(model.seen).toHaveLength(2);
    expect(last.action!.card.rows).toEqual([{ label: 'Department', value: 'HR', previous: 'Engineering' }]);
  });
});

describe('reads and permissions', () => {
  it('answers a read with one model call and a table', async () => {
    const api = new FakeApi([row('Mike Johnson', 'mike@company.com'), row('Mike Ross', 'mike.ross@company.com')]);
    const model = scriptedModel(toolCall('list_employees', { search: 'Mike', department: '' }));
    const { last } = await turn({ api, message: 'Find Mike', model });
    expect(model.seen).toHaveLength(1);
    expect(last.result!.text).toBe('**2 employees** matching "Mike".');
    expect(last.result!.table!.rows.map((r) => r.name)).toEqual(['Mike Johnson', 'Mike Ross']);
  });

  it('counts by department (5.9)', async () => {
    const api = new FakeApi([row('A One', 'a@x.com'), row('B Two', 'b@x.com'), row('C Three', 'c@x.com', D_HR)]);
    const { last } = await turn({ api, toolCall: { name: 'count_employees', args: { department: 'Engineering' } } });
    expect(last.result!.text).toBe('**2 active employees** work in Engineering.');
  });

  it('never offers or runs write tools for an ORG_USER', async () => {
    const tools = await allowedTools(employeeModule, employeeUser);
    expect(modelToolsFor(employeeModule, tools).map((t) => t.function.name)).toEqual(['list_employees', 'count_employees']);
    const api = new FakeApi();
    const { last } = await turn({ user: employeeUser, api, toolCall: { name: 'create_employee', args: { name: 'X' } } });
    expect(last.result!.text).toBe('That action is not available to you.');
    expect(api.writes()).toEqual([]);
  });
});
