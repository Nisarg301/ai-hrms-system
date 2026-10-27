import { confirmAction } from '../../src/ai/agent.service';
import { formatDay, resolveDate } from '../../src/ai/dates';
import { deadlineInstant } from '../../src/ai/modules/project.helpers';
import { projectModule } from '../../src/ai/modules/project.module';
import { allowedTools } from '../../src/ai/registry';
import { roleRepository } from '../../src/repositories/role.repository';
import { addDays, todayIso } from '../../src/utils/dates';
import { admin, employeeUser, FakeProjectApi, project, scriptedModel, stubPersistence, toolCall, turn, TurnOptions } from './support';

stubPersistence();

const today = todayIso();
const run = (opts: TurnOptions) => turn({ module: projectModule, ...opts });

/** An ORG_USER whose role grants these project rights. */
function grantProjects(rights: { read?: boolean; create?: boolean; update?: boolean; delete?: boolean }) {
  jest.spyOn(roleRepository, 'findById').mockResolvedValue({
    permissions: [{ module: 'projects', read: false, create: false, update: false, delete: false, ...rights }],
  } as never);
}

describe('create_project', () => {
  it('asks for the missing description, takes the reply without the model, and creates on Confirm (4.1)', async () => {
    const api = new FakeProjectApi();
    const deadline = addDays(today, 30);
    const first = await run({
      api,
      message: `Create a project called Apollo due ${deadline}`,
      model: scriptedModel(toolCall('create_project', { name: 'Apollo', deadline, description: '' })),
    });
    expect(first.last.result!.text).toBe(`I'll create Apollo, due ${formatDay(deadline)}. I still need a short **description**.`);

    // The only missing thing was the description: the reply is taken as it, with no model call.
    const second = await run({ api, conversationId: first.conversationId, message: 'Rewrite of the customer mobile app', model: scriptedModel() });
    expect(second.last.action!.card.rows).toEqual([
      { label: 'Name', value: 'Apollo' },
      { label: 'Description', value: 'Rewrite of the customer mobile app' },
      { label: 'Deadline', value: formatDay(deadline) },
      { label: 'Status', value: 'Planning' },
    ]);
    expect(api.writes()).toEqual([]);

    const done = await confirmAction({ user: admin, token: 't', actionId: second.last.action!.id, api });
    expect(api.writes()).toEqual([
      { method: 'POST', path: '/projects', body: { name: 'Apollo', description: 'Rewrite of the customer mobile app', deadline: deadlineInstant(deadline), status: 'planning' } },
    ]);
    expect(done.message.result!.text).toBe(`✅ **Project created:** Apollo · due ${formatDay(deadline)} · Planning.`);
  });

  it('takes a missing deadline from a plain reply such as "Friday", without the model', async () => {
    const api = new FakeProjectApi();
    const first = await run({
      api,
      message: 'Create a project called Zephyr, a payments revamp',
      model: scriptedModel(toolCall('create_project', { name: 'Zephyr', description: 'a payments revamp' })),
    });
    expect(first.last.result!.text).toBe("I'll create Zephyr. I still need the **deadline**.");
    // Read from the reply by the server (as 2026-..-..), so it isn't dropped for not being the reply's own words.
    const second = await run({ api, conversationId: first.conversationId, message: 'Friday', model: scriptedModel() });
    expect(second.last.action!.card.rows.find((r) => r.label === 'Deadline')!.value).toBe(formatDay(resolveDate('Friday', today)!));
  });

  it('keeps Planning when the model invents a status the user never said', async () => {
    const api = new FakeProjectApi();
    const deadline = addDays(today, 30);
    const { last } = await run({
      api,
      message: `New project Zephyr, payments revamp, due ${deadline}`,
      model: scriptedModel(toolCall('create_project', { name: 'Zephyr', description: 'payments revamp', deadline, status: 'done' })),
    });
    expect(last.action!.card.rows.find((r) => r.label === 'Status')!.value).toBe('Planning');
  });

  it('warns about a project with the same name, and a deadline in the past', async () => {
    const api = new FakeProjectApi([project('Apollo', addDays(today, 10))]);
    const past = addDays(today, -3);
    const { last } = await run({
      api,
      message: `New project Apollo, mobile app rewrite, deadline ${past}, already in progress`,
      model: scriptedModel(toolCall('create_project', { name: 'Apollo', description: 'mobile app rewrite', deadline: past, status: 'in progress' })),
    });
    const card = last.action!.card;
    expect(card.rows.find((r) => r.label === 'Status')!.value).toBe('Active');
    expect(card.warnings).toEqual([`The deadline ${formatDay(past)} is in the past.`, `A project called "Apollo" already exists (due ${formatDay(addDays(today, 10))}).`]);
  });
});

describe('update_project and delete_project', () => {
  it('puts a project on hold, showing old → new (4.2)', async () => {
    const apollo = project('Apollo', addDays(today, 20), 'active');
    const api = new FakeProjectApi([apollo]);
    const { last } = await run({ api, message: 'Put Apollo on hold', model: scriptedModel(toolCall('update_project', { project: 'Apollo', status: 'on hold' })) });
    expect(last.action!.card.rows).toEqual([{ label: 'Status', value: 'On hold', previous: 'Active' }]);
    const done = await confirmAction({ user: admin, token: 't', actionId: last.action!.id, api });
    expect(api.writes()).toEqual([{ method: 'PUT', path: `/projects/${apollo.id}`, body: { status: 'on-hold' } }]);
    expect(done.message.result!.text).toBe('✅ Updated **Apollo**: status is now On hold.');
  });

  it('moves a deadline, storing it the way the page does', async () => {
    const apollo = project('Apollo', addDays(today, 20));
    const api = new FakeProjectApi([apollo]);
    const moved = addDays(today, 45);
    const { last } = await run({ api, message: `Push the Apollo deadline to ${moved}`, model: scriptedModel(toolCall('update_project', { project: 'Apollo', deadline: moved })) });
    expect(last.action!.card.rows).toEqual([{ label: 'Deadline', value: formatDay(moved), previous: formatDay(addDays(today, 20)) }]);
    await confirmAction({ user: admin, token: 't', actionId: last.action!.id, api });
    expect(api.writes()[0]).toMatchObject({ body: { deadline: deadlineInstant(moved) } });
  });

  it('reads the broken tool call llama3.2 writes, with `name` meaning the project', async () => {
    const apollo = project('Apollo', addDays(today, 20), 'active');
    const api = new FakeProjectApi([apollo]);
    // Verbatim from the eval: the `":` after parameters is missing and an invented reply follows.
    const content = '{"name":"update_project","parameters{"deadline":"","description":"","name":"Apollo","status":"on hold"}} assistant\n\nProject Apollo is now on hold.';
    const model = scriptedModel({ content, toolCalls: [] });
    const { last, events } = await run({ api, message: 'Put Apollo on hold', model });
    expect(model.seen).toHaveLength(1);
    expect(last.action!.card.rows).toEqual([{ label: 'Status', value: 'On hold', previous: 'Active' }]);
    expect(events.filter((e) => e.type === 'token')).toEqual([]);
  });

  it('drops a status the user never asked for', async () => {
    const apollo = project('Apollo', addDays(today, 20), 'active');
    const api = new FakeProjectApi([apollo]);
    const moved = addDays(today, 40);
    const { last } = await run({
      api,
      message: `Push the Apollo deadline to ${moved}`,
      model: scriptedModel(toolCall('update_project', { project: 'Apollo', deadline: moved, status: 'done' })),
    });
    expect(last.action!.card.rows.map((r) => r.label)).toEqual(['Deadline']);
  });

  it('keeps the requested change through a "which one?" button', async () => {
    const api = new FakeProjectApi([project('Apollo Web', addDays(today, 5)), project('Apollo Mobile', addDays(today, 9))]);
    const first = await run({ api, message: 'Put Apollo on hold', model: scriptedModel(toolCall('update_project', { project: 'Apollo', status: 'on hold' })) });
    const button = first.last.result!.buttons![1];
    const second = await run({ api, conversationId: first.conversationId, toolCall: button.toolCall });
    expect(second.last.action!.card.title).toBe('Update Apollo Mobile');
    expect(second.last.action!.card.rows).toEqual([{ label: 'Status', value: 'On hold', previous: 'Active' }]);
  });

  it('asks which project when several match', async () => {
    const api = new FakeProjectApi([project('Apollo Web', addDays(today, 5)), project('Apollo Mobile', addDays(today, 9))]);
    const { last } = await run({ api, message: 'Mark Apollo done', model: scriptedModel(toolCall('update_project', { project: 'Apollo', status: 'done' })) });
    expect(last.result!.text).toBe('2 projects match "Apollo". Which one?');
    expect(last.result!.buttons!.map((b) => b.label)).toEqual([`Apollo Web · due ${formatDay(addDays(today, 5))}`, `Apollo Mobile · due ${formatDay(addDays(today, 9))}`]);
  });

  it('warns about linked tasks before a delete (4.4)', async () => {
    const apollo = project('Apollo', addDays(today, 20));
    const api = new FakeProjectApi([apollo]);
    api.tasksByProject.set(apollo.id, 3);
    const { last } = await run({ api, message: 'Delete Apollo', model: scriptedModel(toolCall('delete_project', { project: 'Apollo' })) });
    expect(last.action!.card.tone).toBe('danger');
    expect(last.action!.card.warnings).toEqual(['3 tasks are linked to this project. They are kept, but will show the project as "Unknown".']);
    await confirmAction({ user: admin, token: 't', actionId: last.action!.id, api });
    expect(api.writes()).toEqual([{ method: 'DELETE', path: `/projects/${apollo.id}` }]);
  });

  it('says nothing about tasks when the user may not read them', async () => {
    const api = new FakeProjectApi([project('Apollo', addDays(today, 20))]);
    api.tasksForbidden = true;
    const { last } = await run({ api, message: 'Delete Apollo', model: scriptedModel(toolCall('delete_project', { project: 'Apollo' })) });
    expect(last.action!.card.warnings).toEqual([]);
  });
});

describe('reads', () => {
  it('lists overdue projects: deadline passed and not completed (4.3)', async () => {
    const late = project('Late one', addDays(today, -5), 'active');
    const api = new FakeProjectApi([late, project('Finished', addDays(today, -5), 'completed'), project('Future', addDays(today, 5))]);
    const { last } = await run({ api, toolCall: { name: 'list_projects', args: { due: 'overdue' } } });
    expect(api.calls[0].query).toMatchObject({ status: 'planning,active,on-hold', dueTo: addDays(today, -1) });
    expect(last.result!.text).toBe(`**Late one** · Active · due ${formatDay(addDays(today, -5))} (overdue) · 0 tasks · Late one work`);
  });

  it('counts by status when no filter is given', async () => {
    const api = new FakeProjectApi([project('A', today, 'active'), project('B', today, 'active'), project('C', today, 'on-hold')]);
    const { last } = await run({ api, toolCall: { name: 'count_projects', args: {} } });
    expect(last.result!.text).toBe('**3 projects** in total.');
    expect(last.result!.table!.rows).toEqual([
      { status: 'Planning', count: '0' },
      { status: 'Active', count: '2' },
      { status: 'Completed', count: '0' },
      { status: 'On hold', count: '1' },
    ]);
  });

  it('explains an unknown status instead of guessing', async () => {
    const api = new FakeProjectApi();
    const { last } = await run({ api, toolCall: { name: 'list_projects', args: { status: 'purple' } } });
    expect(last.result!.text).toBe('"purple" isn\'t a project status. Use Planning, Active, Completed or On hold.');
  });
});

describe('permissions follow the role matrix', () => {
  it('gives a read-only user only the read tools, and refuses a write', async () => {
    grantProjects({ read: true });
    expect((await allowedTools(projectModule, employeeUser)).map((t) => t.name)).toEqual(['list_projects', 'count_projects']);
    const api = new FakeProjectApi();
    const { last } = await run({ user: employeeUser, api, toolCall: { name: 'create_project', args: {}, form: true } });
    expect(last.result!.text).toBe('That action is not available to you.');
    expect(api.writes()).toEqual([]);
  });

  it('gives a user with update rights the update tool but not delete', async () => {
    grantProjects({ read: true, update: true });
    expect((await allowedTools(projectModule, employeeUser)).map((t) => t.name)).toEqual(['list_projects', 'count_projects', 'update_project']);
  });
});
