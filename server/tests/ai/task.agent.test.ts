import { confirmAction, toolCallFromText } from '../../src/ai/agent.service';
import { formatDay, resolveDate } from '../../src/ai/dates';
import { taskModule } from '../../src/ai/modules/task.module';
import { allowedTools } from '../../src/ai/registry';
import { roleRepository } from '../../src/repositories/role.repository';
import { addDays, todayIso } from '../../src/utils/dates';
import {
  admin,
  employeeUser,
  FakeTaskApi,
  M_MIKE_J,
  M_MIKE_R,
  M_RAHUL,
  P_APOLLO,
  P_HERMES,
  scriptedModel,
  stubPersistence,
  toolCall,
  turn,
  TurnOptions,
} from './support';

stubPersistence();

const today = todayIso();
const run = (opts: TurnOptions) => turn({ module: taskModule, ...opts });

/** An ORG_USER (Priya Shah) whose role grants these task rights, and reading projects. */
function grantTasks(rights: { read?: boolean; create?: boolean; update?: boolean; delete?: boolean }) {
  jest.spyOn(roleRepository, 'findById').mockResolvedValue({
    permissions: [
      { module: 'tasks', read: false, create: false, update: false, delete: false, ...rights },
      { module: 'projects', read: true, create: false, update: false, delete: false },
    ],
  } as never);
}

describe('create_task', () => {
  it('asks for what is missing, takes the buttons and a plain reply, and creates on Confirm (4.1)', async () => {
    grantTasks({ read: true, create: true });
    const api = new FakeTaskApi();
    const first = await run({
      user: employeeUser,
      api,
      message: 'Create a task to fix the login bug in Apollo',
      model: scriptedModel(toolCall('create_task', { title: 'Fix the login bug', project: 'Apollo' })),
    });
    expect(first.last.result!.text).toBe("I'll create **Fix the login bug** in Apollo. I still need a short **description**, the **due date** and **who works on it**.");
    expect(first.last.result!.buttons!.map((b) => b.label)).toEqual(['Same as the title', 'Assign to me', 'Fill in the form instead']);

    const [sameAsTitle, assignToMe] = first.last.result!.buttons!;
    const second = await run({ user: employeeUser, api, conversationId: first.conversationId, toolCall: sameAsTitle.toolCall });
    expect(second.last.result!.text).toBe("I'll create **Fix the login bug** in Apollo. I still need the **due date** and **who works on it**.");
    const third = await run({ user: employeeUser, api, conversationId: first.conversationId, toolCall: assignToMe.toolCall });
    expect(third.last.result!.text).toBe("I'll create **Fix the login bug** in Apollo. I still need the **due date**.");

    // The due date is the only thing missing: the reply is read without the model.
    const friday = resolveDate('Friday', today)!;
    const fourth = await run({ user: employeeUser, api, conversationId: first.conversationId, message: 'Friday', model: scriptedModel() });
    expect(fourth.last.action!.card.rows).toEqual([
      { label: 'Title', value: 'Fix the login bug' },
      { label: 'Description', value: 'Fix the login bug' },
      { label: 'Project', value: 'Apollo' },
      { label: 'Members', value: 'Priya Shah' },
      { label: 'Due date', value: formatDay(friday) },
      { label: 'Status', value: 'To Do' },
    ]);
    expect(api.writes()).toEqual([]);

    const done = await confirmAction({ user: employeeUser, token: 't', actionId: fourth.last.action!.id, api });
    expect(api.writes()).toEqual([
      { method: 'POST', path: '/tasks', body: { title: 'Fix the login bug', description: 'Fix the login bug', dueDate: friday, status: 'todo', projectId: P_APOLLO, userId: [employeeUser.id] } },
    ]);
    expect(done.message.result!.text).toBe(`✅ **Task created:** Fix the login bug · Apollo · due ${formatDay(friday)} · Priya Shah.`);
  });

  it('fills every field from one sentence (4.2)', async () => {
    const api = new FakeTaskApi();
    const due = addDays(today, 12);
    const { last } = await run({
      api,
      message: `Add a task "Write release notes" for Rahul and Mike Johnson in Hermes, due ${due}: notes for version 2.1`,
      model: scriptedModel(toolCall('create_task', { title: 'Write release notes', members: 'Rahul and Mike Johnson', project: 'Hermes', dueDate: due, description: 'notes for version 2.1' })),
    });
    expect(last.action!.card.rows).toEqual([
      { label: 'Title', value: 'Write release notes' },
      { label: 'Description', value: 'notes for version 2.1' },
      { label: 'Project', value: 'Hermes' },
      { label: 'Members', value: 'Rahul Verma and Mike Johnson' },
      { label: 'Due date', value: formatDay(due) },
      { label: 'Status', value: 'To Do' },
    ]);
    expect(last.action!.card.form).toMatchObject({ kind: 'task', labels: { [P_HERMES]: 'Hermes', [M_RAHUL]: 'Rahul Verma', [M_MIKE_J]: 'Mike Johnson' } });
  });

  it("drops a status and a member the user never gave, and uses the only project", async () => {
    const api = new FakeTaskApi();
    api.projects = [{ id: P_APOLLO, name: 'Apollo' }];
    const due = addDays(today, 3);
    const { last } = await run({
      api,
      message: `New task Fix Safari login for Rahul, due ${due}: users can't log in`,
      model: scriptedModel(toolCall('create_task', { title: 'Fix Safari login', members: 'Rahul and Ann', dueDate: due, description: "users can't log in", status: 'done' })),
    });
    const rows = Object.fromEntries(last.action!.card.rows.map((r) => [r.label, r.value]));
    expect(rows).toMatchObject({ Project: 'Apollo', Members: 'Rahul Verma', Status: 'To Do' });
  });

  it('warns about a due date in the past and a title the project already has', async () => {
    const api = new FakeTaskApi();
    api.task('Fix the login bug', { dueDate: addDays(today, 5) });
    const past = addDays(today, -3);
    const { last } = await run({
      api,
      message: `Add Fix the login bug to Apollo for Rahul, due ${past}, Safari users can't log in`,
      model: scriptedModel(toolCall('create_task', { title: 'Fix the login bug', project: 'Apollo', members: 'Rahul', dueDate: past, description: "Safari users can't log in" })),
    });
    expect(last.action!.card.warnings).toEqual([`The due date ${formatDay(past)} is in the past.`, `Apollo already has a task called "Fix the login bug" (due ${formatDay(addDays(today, 5))}).`]);
  });

  it('asks which person when a name matches two, and keeps the answer', async () => {
    const api = new FakeTaskApi();
    const due = addDays(today, 3);
    const first = await run({
      api,
      message: `Create Fix Safari login in Apollo for Mike, due ${due}: users can't log in`,
      model: scriptedModel(toolCall('create_task', { title: 'Fix Safari login', project: 'Apollo', members: 'Mike', dueDate: due, description: "users can't log in" })),
    });
    expect(first.last.result!.text).toBe('2 people match "Mike". Which one?');
    const ross = first.last.result!.buttons!.find((b) => b.label === 'Mike Ross')!;
    const second = await run({ api, conversationId: first.conversationId, toolCall: ross.toolCall });
    expect(second.last.action!.card.rows.find((r) => r.label === 'Members')!.value).toBe('Mike Ross');
    expect(second.last.action!.card.rows.find((r) => r.label === 'Title')!.value).toBe('Fix Safari login');
  });

  it('offers no "Assign to me" to an admin, who is not an employee', async () => {
    const api = new FakeTaskApi();
    const { last } = await run({ api, message: 'Create a task to fix the login bug in Apollo', model: scriptedModel(toolCall('create_task', { title: 'Fix the login bug', project: 'Apollo' })) });
    expect(last.result!.buttons!.map((b) => b.label)).toEqual(['Same as the title', 'Fill in the form instead']);
  });
});

describe('update_task', () => {
  it('changes the status, showing old → new (4.3)', async () => {
    const api = new FakeTaskApi();
    const t = api.task('Fix the login bug');
    const { last } = await run({ api, message: 'Mark the login bug as done', model: scriptedModel(toolCall('update_task', { task: 'login bug', status: 'done' })) });
    expect(last.action!.card.rows).toEqual([{ label: 'Status', value: 'Done', previous: 'To Do' }]);
    const done = await confirmAction({ user: admin, token: 't', actionId: last.action!.id, api });
    expect(api.writes()).toEqual([{ method: 'PUT', path: `/tasks/${t.id}`, body: { status: 'done' } }]);
    expect(done.message.result!.text).toBe('✅ Updated **Fix the login bug**: status is now Done.');
  });

  it("doesn't read a status word in the task's own title as a change", async () => {
    const api = new FakeTaskApi();
    api.task('Fix the done button');
    const { last } = await run({
      api,
      message: 'Change the description of the done button task to Hides the dialog',
      model: scriptedModel(toolCall('update_task', { task: 'done button', description: 'Hides the dialog', status: 'done' })),
    });
    expect(last.action!.card.rows.map((r) => r.label)).toEqual(['Description']);
  });

  it('adds, removes and replaces members by the verb the user used', async () => {
    const one = new FakeTaskApi();
    one.task('Fix the login bug', { userId: [M_RAHUL] });
    const added = await run({ api: one, message: 'Add Mike Johnson to the login bug task', model: scriptedModel(toolCall('update_task', { task: 'login bug', members: 'Mike Johnson' })) });
    expect(added.last.action!.card.rows).toEqual([{ label: 'Members', value: 'Rahul Verma and Mike Johnson', previous: 'Rahul Verma' }]);

    const api = new FakeTaskApi();
    const t = api.task('Fix the login bug', { userId: [M_RAHUL, M_MIKE_J] });
    const removed = await run({ api, message: 'Remove Rahul from the login bug task', model: scriptedModel(toolCall('update_task', { task: 'login bug', members: 'Rahul' })) });
    expect(removed.last.action!.card.rows).toEqual([{ label: 'Members', value: 'Mike Johnson', previous: 'Rahul Verma and Mike Johnson' }]);

    const replaced = await run({ api, message: 'Assign the login bug to Priya', model: scriptedModel(toolCall('update_task', { task: 'login bug', members: 'Priya' })) });
    expect(replaced.last.action!.card.rows).toEqual([{ label: 'Members', value: 'Priya Shah', previous: 'Rahul Verma and Mike Johnson' }]);
    await confirmAction({ user: admin, token: 't', actionId: replaced.last.action!.id, api });
    expect(api.writes()).toEqual([{ method: 'PUT', path: `/tasks/${t.id}`, body: { userId: [employeeUser.id] } }]);
  });

  it("won't take a task's last member off", async () => {
    const api = new FakeTaskApi();
    api.task('Fix the login bug', { userId: [M_RAHUL] });
    const { last } = await run({ api, message: 'Remove Rahul from the login bug task', model: scriptedModel(toolCall('update_task', { task: 'login bug', members: 'Rahul' })) });
    expect(last.action).toBeNull();
    expect(last.result!.text).toBe('A task needs at least one member, and Rahul Verma is the only one on it. Add someone else first.');
  });

  it('moves a task only when asked to, and otherwise uses the project to tell tasks apart', async () => {
    const api = new FakeTaskApi();
    api.task('Fix the login bug', { projectId: P_APOLLO });
    const inHermes = api.task('Fix the login bug', { projectId: P_HERMES });
    const marked = await run({
      api,
      message: 'Mark the login bug in Hermes as done',
      model: scriptedModel(toolCall('update_task', { task: 'login bug', project: 'Hermes', status: 'done' })),
    });
    expect(marked.last.action!.card.rows).toEqual([{ label: 'Status', value: 'Done', previous: 'To Do' }]);
    expect(marked.last.action!.card.form).toMatchObject({ values: { projectId: P_HERMES } });
    expect(String(marked.last.action!.card.title)).toBe('Update Fix the login bug');

    const single = new FakeTaskApi();
    const t = single.task('Write release notes', { projectId: P_APOLLO });
    const moved = await run({ api: single, message: 'Move the release notes task to Hermes', model: scriptedModel(toolCall('update_task', { task: 'release notes', project: 'Hermes' })) });
    expect(moved.last.action!.card.rows).toEqual([{ label: 'Project', value: 'Hermes', previous: 'Apollo' }]);
    await confirmAction({ user: admin, token: 't', actionId: moved.last.action!.id, api: single });
    expect(single.writes()).toEqual([{ method: 'PUT', path: `/tasks/${t.id}`, body: { projectId: P_HERMES } }]);
    expect(inHermes.status).toBe('todo');
  });

  it('moves the due date', async () => {
    const api = new FakeTaskApi();
    api.task('Fix the login bug', { dueDate: addDays(today, 4) });
    const moved = addDays(today, 7);
    const { last } = await run({ api, message: `Push the login bug task to ${moved}`, model: scriptedModel(toolCall('update_task', { task: 'login bug', dueDate: moved })) });
    expect(last.action!.card.rows).toEqual([{ label: 'Due date', value: formatDay(moved), previous: formatDay(addDays(today, 4)) }]);
  });

  it('asks which task when several hold the words, and keeps the change through the button', async () => {
    const api = new FakeTaskApi();
    api.task('Fix login bug', { dueDate: addDays(today, 2) });
    api.task('Login bug follow-up', { dueDate: addDays(today, 9), projectId: P_HERMES });
    const first = await run({ api, message: 'Mark the login bug as done', model: scriptedModel(toolCall('update_task', { task: 'login bug', status: 'done' })) });
    expect(first.last.result!.text).toBe('2 tasks match "login bug". Which one?');
    expect(first.last.result!.buttons!.map((b) => b.label)).toEqual([
      `Fix login bug · Apollo · due ${formatDay(addDays(today, 2))}`,
      `Login bug follow-up · Hermes · due ${formatDay(addDays(today, 9))}`,
    ]);
    const second = await run({ api, conversationId: first.conversationId, toolCall: first.last.result!.buttons![1].toolCall });
    expect(second.last.action!.card.title).toBe('Update Login bug follow-up');
    expect(second.last.action!.card.rows).toEqual([{ label: 'Status', value: 'Done', previous: 'To Do' }]);
  });

  it('finds a task by its words in another order', async () => {
    const api = new FakeTaskApi();
    api.task('Fix the login bug on Safari');
    const { last } = await run({ api, message: 'The Safari login bug is blocked', model: scriptedModel(toolCall('update_task', { task: 'Safari login bug', status: 'blocked' })) });
    expect(last.action!.card.title).toBe('Update Fix the login bug on Safari');
  });
});

describe('delete_task', () => {
  it('deletes after a red card (4.5)', async () => {
    const api = new FakeTaskApi();
    const t = api.task('Write release notes', { projectId: P_HERMES });
    const { last } = await run({ api, message: 'Delete the release notes task', model: scriptedModel(toolCall('delete_task', { task: 'release notes' })) });
    expect(last.action!.card).toMatchObject({ title: 'Delete Write release notes?', tone: 'danger', confirmLabel: 'Delete task' });
    const done = await confirmAction({ user: admin, token: 't', actionId: last.action!.id, api });
    expect(api.writes()).toEqual([{ method: 'DELETE', path: `/tasks/${t.id}` }]);
    expect(done.message.result!.text).toBe('✅ **Write release notes** was deleted.');
  });
});

describe('reads (4.4)', () => {
  it("lists the user's open tasks", async () => {
    grantTasks({ read: true });
    const api = new FakeTaskApi();
    api.task('Fix the login bug', { userId: [employeeUser.id], dueDate: addDays(today, 2) });
    api.task('Write release notes', { userId: [employeeUser.id, M_RAHUL], status: 'in-progress', dueDate: addDays(today, 5) });
    api.task('Old work', { userId: [employeeUser.id], status: 'done' });
    api.task('Not mine', { userId: [M_RAHUL] });
    const { last } = await run({ user: employeeUser, api, toolCall: { name: 'list_tasks', args: { member: 'me', status: 'open' } } });
    expect(api.calls.find((c) => c.path === '/tasks')!.query).toMatchObject({ memberId: employeeUser.id, status: 'todo,in-progress,blocked', sortBy: 'dueDate' });
    expect(last.result!.text).toBe('**2 open tasks** assigned to you.');
    expect(last.result!.table!.rows.map((r) => [r.title, r.members, r.status])).toEqual([
      ['Fix the login bug', 'Priya Shah', 'To Do'],
      ['Write release notes', 'Priya Shah and Rahul Verma', 'In Progress'],
    ]);
  });

  it('lists overdue tasks: due date passed and not done', async () => {
    const api = new FakeTaskApi();
    api.task('Late one', { dueDate: addDays(today, -2) });
    api.task('Done late', { dueDate: addDays(today, -2), status: 'done' });
    api.task('Future', { dueDate: addDays(today, 2) });
    const { last } = await run({ api, toolCall: { name: 'list_tasks', args: { due: 'overdue' } } });
    expect(last.result!.text).toBe(`**Late one** · To Do · due ${formatDay(addDays(today, -2))} (overdue) · Apollo · Rahul Verma · Late one work`);
  });

  it("lists a project's tasks, and ignores a filter the user never asked for", async () => {
    const api = new FakeTaskApi();
    api.task('A', { status: 'blocked' });
    api.task('B');
    api.task('C', { projectId: P_HERMES });
    const apollo = await run({ api, message: "Show Apollo's tasks", model: scriptedModel(toolCall('list_tasks', { project: 'Apollo' })) });
    expect(apollo.last.result!.text).toBe('**2 tasks** in Apollo.');
    const all = await run({ api, message: 'Show all tasks', model: scriptedModel(toolCall('list_tasks', { status: 'blocked' })) });
    expect(all.last.result!.text).toBe('**3 tasks**.');
  });

  it('counts per status, for everyone or for one person', async () => {
    const api = new FakeTaskApi();
    api.task('A');
    api.task('B');
    api.task('C', { status: 'done' });
    api.task('D', { status: 'blocked', userId: [M_MIKE_R] });
    const all = await run({ api, toolCall: { name: 'count_tasks', args: {} } });
    expect(all.last.result!.text).toBe('**4 tasks** in total.');
    expect(all.last.result!.table!.rows).toEqual([
      { status: 'To Do', count: '2' },
      { status: 'In Progress', count: '0' },
      { status: 'Done', count: '1' },
      { status: 'Blocked', count: '1' },
    ]);
    const rahul = await run({ api, message: 'How many tasks does Rahul have?', model: scriptedModel(toolCall('count_tasks', { member: 'Rahul' })) });
    expect(rahul.last.result!.text).toBe('**3 tasks** for Rahul Verma: 2 To Do and 1 Done.');
  });
});

describe('what the first eval run showed (verbatim model calls)', () => {
  const everything = () => grantTasks({ read: true, create: true, update: true, delete: true });

  it('turns a delete the user never asked for into the change they did ask for', async () => {
    const api = new FakeTaskApi();
    api.task('Fix the login bug');
    const { last } = await run({ api, message: 'Mark the login bug as done', model: scriptedModel(toolCall('delete_task', { task: 'mark the login bug' })) });
    expect(last.action!.card.tone).toBe('default');
    expect(last.action!.card.rows).toEqual([{ label: 'Status', value: 'Done', previous: 'To Do' }]);
    expect(last.action!.tool).toBe('update_task');
  });

  it('turns a create with no word for creating into an update', async () => {
    everything();
    const api = new FakeTaskApi();
    api.task('Fix the login bug');
    const call = { description: 'Login bug wala task done kar do', dueDate: '', members: 'me', project: '', status: '', title: 'Login bug wala task done kar do' };
    const { last } = await run({ user: employeeUser, api, message: 'Login bug wala task done kar do', model: scriptedModel(toolCall('create_task', call)) });
    expect(last.action!.tool).toBe('update_task');
    expect(last.action!.card.rows).toEqual([{ label: 'Status', value: 'Done', previous: 'To Do' }]);
  });

  it('reads the task, the member and the move from the message when the model gives only junk', async () => {
    const api = new FakeTaskApi();
    api.task('Write release notes', { projectId: P_HERMES, userId: [employeeUser.id, M_RAHUL] });
    api.task('Fix the login bug');
    const junk = { description: 'What the task is about' };
    const removed = await run({ api, message: 'Remove Rahul from the release notes', model: scriptedModel(toolCall('update_task', junk)) });
    expect(removed.last.action!.card.rows).toEqual([{ label: 'Members', value: 'Priya Shah', previous: 'Priya Shah and Rahul Verma' }]);
    const moved = await run({ api, message: 'Move the login bug task to Hermes', model: scriptedModel(toolCall('update_task', junk)) });
    expect(moved.last.action!.card.rows).toEqual([{ label: 'Project', value: 'Hermes', previous: 'Apollo' }]);
  });

  it('drops filters that read as nothing', async () => {
    everything();
    const api = new FakeTaskApi();
    api.task('Fix the login bug', { userId: [employeeUser.id] });
    api.task('Write release notes', { userId: [employeeUser.id], projectId: P_HERMES, dueDate: addDays(today, -2) });
    const mine = await run({ user: employeeUser, api, message: 'Show my open tasks', model: scriptedModel(toolCall('list_tasks', { due: 'open', member: 'me', page: 1, project: '', search: '', status: 'open' })) });
    expect(mine.last.result!.text).toBe('**2 open tasks** assigned to you.');
    const late = await run({ api, message: "What's overdue?", model: scriptedModel(toolCall('list_tasks', { due: 'What is overdue', member: 'me', status: 'What is overdue' })) });
    expect(late.last.result!.text).toMatch(/^\*\*Write release notes\*\* · To Do · due .* \(overdue\)/);
    const hermes = await run({ api, message: 'Show the tasks in Hermes', model: scriptedModel(toolCall('list_tasks', { member: 'Hermes', project: 'Hermes' })) });
    expect(hermes.last.result!.text).toMatch(/^\*\*Write release notes\*\*/);
    const counted = await run({ api, message: 'Count tasks by status', model: scriptedModel(toolCall('count_tasks', { status: 'status' })) });
    expect(counted.last.result!.text).toBe('**2 tasks** in total.');
  });

  it('cleans a title the model wrapped in the request, and finds the project in the message', async () => {
    const api = new FakeTaskApi();
    const call = { members: 'Rahul', project: '', status: '', title: 'create task to fix the signup page in Apollo', description: 'fix the signup page in Apollo', dueDate: 'Friday' };
    const { last } = await run({ api, message: 'Create a task to fix the signup page in Apollo for Rahul, due Friday', model: scriptedModel(toolCall('create_task', call)) });
    expect(last.result!.text).toBe("I'll create **Fix the signup page** in Apollo. I still need a short **description**.");
  });

  it('takes the description after a colon when the model put it elsewhere', async () => {
    everything();
    const api = new FakeTaskApi();
    const call = { description: 'Write the test plan', dueDate: '30 Oct: cover login and signup', members: 'Rahul, me', project: 'Hermes', status: '', title: 'Write the test plan' };
    const { last } = await run({
      user: employeeUser,
      api,
      message: 'Add a task "Write the test plan" in Hermes for Rahul and me, due 30 Oct: cover login and signup',
      model: scriptedModel(toolCall('create_task', call)),
    });
    const rows = Object.fromEntries(last.action!.card.rows.map((r) => [r.label, r.value]));
    expect(rows).toMatchObject({ Title: 'Write the test plan', Description: 'cover login and signup', Project: 'Hermes', Members: 'Rahul Verma and Priya Shah', 'Due date': formatDay(resolveDate('30 Oct', today)!) });
  });

  it('reads a plain status statement without the model (second eval run)', async () => {
    const api = new FakeTaskApi();
    api.task('Review the API spec');
    // scriptedModel() with no replies fails the test if the model is called.
    const { last } = await run({ api, message: "I've started the review of the API spec", model: scriptedModel() });
    expect(last.action!.card.rows).toEqual([{ label: 'Status', value: 'In Progress', previous: 'To Do' }]);
  });

  it('reads "overdue" given as a status, and a due date left inside the task words', async () => {
    const api = new FakeTaskApi();
    api.task('Fix the login bug', { dueDate: addDays(today, -1) });
    const late = await run({ api, message: "What's overdue?", model: scriptedModel(toolCall('list_tasks', { status: 'overdue' })) });
    expect(late.last.result!.text).toMatch(/\(overdue\)/);
    const call = { status: '', task: 'Push the login bug to next Monday', description: '', dueDate: '', members: '', newTitle: '', project: '' };
    const pushed = await run({ api, message: 'Push the login bug to next Monday', model: scriptedModel(toolCall('update_task', call)) });
    expect(pushed.last.action!.card.rows).toEqual([{ label: 'Due date', value: formatDay(resolveDate('next Monday', today)!), previous: formatDay(addDays(today, -1)) }]);
  });

  it('drops a "member" that is really a status, without a warning', async () => {
    const api = new FakeTaskApi();
    api.task('Fix the login bug');
    // Verbatim from the second eval run; a question, so it goes to the model.
    const call = { dueDate: today, members: 'done', status: 'done', task: 'Mark the login bug' };
    const { last } = await run({ api, message: 'Could you mark the login bug as done?', model: scriptedModel(toolCall('update_task', call)) });
    expect(last.action!.card.rows).toEqual([{ label: 'Status', value: 'Done', previous: 'To Do' }]);
    expect(last.action!.card.warnings).toEqual([]);
  });

  it('finds the task when the message has a word its title lacks', async () => {
    const api = new FakeTaskApi();
    api.task('Fix the login bug');
    const { last } = await run({ api, message: 'The login bug is fixed finally', model: scriptedModel() });
    expect(last.action!.card.title).toBe('Update Fix the login bug');
  });

  it('drops a "member" that is the project the task moves to (six-module eval run)', async () => {
    const api = new FakeTaskApi();
    api.task('Fix the login bug');
    const call = { dueDate: '', description: '', members: 'Hermes', newTitle: '', project: '', status: '', task: 'login bug' };
    const { last } = await run({ api, message: 'Move the login bug task to Hermes', model: scriptedModel(toolCall('update_task', call)) });
    expect(last.action!.card.rows).toEqual([{ label: 'Project', value: 'Hermes', previous: 'Apollo' }]);
    expect(last.action!.card.warnings).toEqual([]);
  });

  it('reads a broken call with a trailing comma and an outer object that never closes (later eval run)', async () => {
    const content = '{"name":"list_tasks","parameters{"due":"",} assistant\n\nBlocked Tasks:\n\n1. Ta';
    expect(toolCallFromText(content)).toEqual({ name: 'list_tasks', args: { due: '' } });
    const api = new FakeTaskApi();
    api.task('Update the onboarding docs', { status: 'blocked' });
    api.task('Fix the login bug');
    // The recovered call has no status: "blocked" comes from the message.
    const { last } = await run({ api, message: 'Which tasks are blocked?', model: scriptedModel({ content, toolCalls: [] }) });
    expect(last.result!.text).toMatch(/^\*\*Update the onboarding docs\*\* · Blocked/);
  });

  it('moves to the project the message names when the model puts the task words in project', async () => {
    const api = new FakeTaskApi();
    api.task('Fix the login bug');
    const call = { dueDate: '', description: '', members: 'Hermes', newTitle: '', project: 'login bug task', status: '' };
    const { last } = await run({ api, message: 'Move the login bug task to Hermes', model: scriptedModel(toolCall('update_task', call)) });
    expect(last.action!.card.rows).toEqual([{ label: 'Project', value: 'Hermes', previous: 'Apollo' }]);
    expect(last.action!.card.warnings).toEqual([]);
  });

  it('repairs a tool call written with keys missing their opening quote', () => {
    const content = '{"name":"update_task","parameters":{"task":"release notes","description":"",members":"Mike Johnson, me",status":""}}';
    expect(toolCallFromText(content)).toEqual({ name: 'update_task', args: { task: 'release notes', description: '', members: 'Mike Johnson, me', status: '' } });
  });
});

describe('permissions follow the role matrix', () => {
  it('gives a read-only user only the read tools, and refuses a write', async () => {
    grantTasks({ read: true });
    expect((await allowedTools(taskModule, employeeUser)).map((t) => t.name)).toEqual(['list_tasks', 'count_tasks']);
    const api = new FakeTaskApi();
    const { last } = await run({ user: employeeUser, api, toolCall: { name: 'create_task', args: {}, form: true } });
    expect(last.result!.text).toBe('That action is not available to you.');
    expect(api.writes()).toEqual([]);
  });

  it('gives a user with update rights the update tool but not create or delete', async () => {
    grantTasks({ read: true, update: true });
    expect((await allowedTools(taskModule, employeeUser)).map((t) => t.name)).toEqual(['list_tasks', 'count_tasks', 'update_task']);
  });

  it('says so when the role cannot read projects', async () => {
    grantTasks({ read: true, create: true });
    const api = new FakeTaskApi();
    api.projectsForbidden = true;
    const { last } = await run({ user: employeeUser, api, toolCall: { name: 'create_task', args: {}, form: true } });
    expect(last.result!.text).toBe("Your role can't read projects, so I can't look one up. The projects permission is needed for this.");
  });
});
