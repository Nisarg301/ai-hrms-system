import { exportsModule } from '../../src/ai/modules/exports.module';
import { env } from '../../src/config/env';
import { employeeUser, FakeExportApi, readRights, scriptedModel, stubPersistence, toolCall, turn, TurnOptions } from './support';

stubPersistence();

const run = (opts: TurnOptions) => turn({ module: exportsModule, ...opts });
const paths = (last: Awaited<ReturnType<typeof run>>['last']) => last.result?.downloads?.map((d) => d.path) ?? [];

describe('plain commands: no model call (section 6)', () => {
  it('downloads all four exports at once (4.2)', async () => {
    const api = new FakeExportApi();
    // scriptedModel() with no replies fails the test if the model is called.
    const { last } = await run({ api, message: 'Download the CSV for employees, documents, projects and tasks', model: scriptedModel() });
    expect(last.result).toEqual({
      text: '**4 CSV files**: Employees, Documents, Projects and Tasks.',
      downloads: [
        { label: 'Employees CSV', path: '/exports/employees' },
        { label: 'Documents CSV', path: '/exports/documents' },
        { label: 'Projects CSV', path: '/exports/projects' },
        { label: 'Tasks CSV', path: '/exports/tasks' },
      ],
      autoDownload: true,
    });
    expect(api.calls.map((c) => c.path)).toEqual(['/auth/me']);
  });

  it('downloads one export, saying what it holds (4.1)', async () => {
    const { last } = await run({ api: new FakeExportApi(), message: 'Download the employees CSV' });
    expect(last.result!.text).toBe('**Employees** CSV: the name, email, job title, department, role and status of every employee.');
    expect(paths(last)).toEqual(['/exports/employees']);
  });

  it('downloads everything except what the user left out (4.3)', async () => {
    const { last } = await run({ api: new FakeExportApi(), message: 'Export everything except documents' });
    expect(last.result!.text).toBe('**3 CSV files**: Employees, Projects and Tasks.');
  });

  it('reads Hinglish', async () => {
    expect(paths((await run({ api: new FakeExportApi(), message: 'Mujhe employees aur projects ki CSV chahiye' })).last)).toEqual(['/exports/employees', '/exports/projects']);
    expect(paths((await run({ api: new FakeExportApi(), message: 'Sab download kar do' })).last)).toHaveLength(4);
  });

  it('notes that CSV opens in Excel', async () => {
    const { last } = await run({ api: new FakeExportApi(), message: 'Download projects as excel' });
    expect(last.result!.text).toBe('**Projects** CSV: the name, description, deadline and status of every project.\nCSV files open in Excel and Google Sheets.');
  });
});

describe('who can export what (section 3)', () => {
  it('leaves out what the role cannot read when the user asks for everything (4.4)', async () => {
    const api = new FakeExportApi(readRights('exports', 'employees', 'projects'));
    const { last } = await run({ user: employeeUser, api, message: 'Download everything' });
    expect(last.result!.text).toBe("**2 CSV files**: Employees and Projects.\nDocuments and Tasks are left out: your role can't read them.");
    expect(paths(last)).toEqual(['/exports/employees', '/exports/projects']);
  });

  it('warns about a named export the role cannot read, and downloads the rest', async () => {
    const api = new FakeExportApi(readRights('exports', 'projects'));
    const { last } = await run({ user: employeeUser, api, message: 'Download documents and projects' });
    expect(paths(last)).toEqual(['/exports/projects']);
    expect(last.result!.warnings).toEqual(["You can't export Documents: your role can't read documents."]);
  });

  it('downloads nothing when every named export is refused', async () => {
    const api = new FakeExportApi(readRights('exports', 'projects'));
    const { last } = await run({ user: employeeUser, api, message: 'Download documents' });
    expect(last.result).toEqual({ text: "You can't export Documents: your role can't read documents." });
  });
});

describe('requests the model reads', () => {
  it('takes the model\'s words when the message names no export', async () => {
    const model = scriptedModel(toolCall('export_csv', { modules: 'projects' }));
    const { last } = await run({ api: new FakeExportApi(), message: 'I need the project list for the board meeting', model });
    expect(model.seen).toHaveLength(1);
    expect(paths(last)).toEqual(['/exports/projects']);
    expect(last.result!.autoDownload).toBe(true);
  });

  it("prefers the user's words to the model's", async () => {
    const model = scriptedModel(toolCall('export_csv', { modules: 'employees, documents' }));
    const { last } = await run({ api: new FakeExportApi(), message: 'Download staff data, but not documents, for the audit', model });
    expect(paths(last)).toEqual(['/exports/employees']);
  });

  it('corrects a typo through the model', async () => {
    const { last } = await run({ api: new FakeExportApi(), message: 'Download the emplyees list', model: scriptedModel(toolCall('export_csv', { modules: ['employees'] })) });
    expect(paths(last)).toEqual(['/exports/employees']);
  });

  it('downloads the whole file when only some rows were asked for, and says so', async () => {
    const { last } = await run({
      api: new FakeExportApi(),
      message: 'Download only the active employees',
      model: scriptedModel(toolCall('export_csv', { modules: 'employees', filter: 'only active' })),
    });
    expect(paths(last)).toEqual(['/exports/employees']);
    expect(last.result!.text).toContain("The CSV has every employee: exports can't be filtered here, but you can filter it in Excel or Google Sheets.");
  });

  it('offers the file for a question instead of downloading it (4.5)', async () => {
    const { last } = await run({ api: new FakeExportApi(), message: "What's in the tasks export?", model: scriptedModel(toolCall('export_csv', { modules: 'tasks' })) });
    expect(last.result!.text).toBe('**Tasks** CSV: the title, description, due date, status, project and members of every task.');
    expect(last.result).toMatchObject({ downloads: [{ label: 'Tasks CSV', path: '/exports/tasks' }], autoDownload: false });
  });

  it('says where attendance is exported, and offers what this page has', async () => {
    const { last } = await run({ api: new FakeExportApi(), message: 'Download attendance', model: scriptedModel(toolCall('export_csv', { modules: 'attendance' })) });
    expect(last.result!.text).toBe('Attendance is exported from the Team attendance page.\nYou can download these as CSV. Which ones do you want?');
    expect(last.result!.downloads).toBeUndefined();
  });

  it('downloads nothing the user never asked for, whatever the model says', async () => {
    // Verbatim from the eval: the model copied "all except documents" from its instructions.
    const { last } = await run({ api: new FakeExportApi(), message: 'Download attendance', model: scriptedModel(toolCall('export_csv', { filter: '', modules: 'all except documents' })) });
    expect(last.result!.downloads).toBeUndefined();
    const listed = await run({ api: new FakeExportApi(), message: 'What can I export?', model: scriptedModel(toolCall('export_csv', { filter: '', modules: 'everything' })) });
    expect(listed.last.result!.text).toBe('You can download these as CSV. Which ones do you want?');
    expect(listed.last.result!.buttons).toHaveLength(5);
  });

  it('downloads "the same again" from the conversation', async () => {
    const api = new FakeExportApi();
    const first = await run({ api, message: 'Download projects' });
    const { last } = await run({ api, conversationId: first.conversationId, message: 'The same again please', model: scriptedModel(toolCall('export_csv', { modules: 'projects' })) });
    expect(paths(last)).toEqual(['/exports/projects']);
  });

  it('answers with the files even when fast reads are off', async () => {
    const fastReads = env.AI_FAST_READS;
    (env as { AI_FAST_READS: boolean }).AI_FAST_READS = false;
    try {
      // One reply only: a second model call to word the answer would fail the test.
      const model = scriptedModel(toolCall('export_csv', { modules: 'projects' }));
      const { last } = await run({ api: new FakeExportApi(), message: 'I need the project list for the board meeting', model });
      expect(paths(last)).toEqual(['/exports/projects']);
    } finally {
      (env as { AI_FAST_READS: boolean }).AI_FAST_READS = fastReads;
    }
  });

  it('replaces a text answer that claims a download', async () => {
    const model = scriptedModel({ content: 'I have downloaded the employees CSV for you.', toolCalls: [] });
    const { last } = await run({ api: new FakeExportApi(), message: 'I want the people stuff for my laptop', model });
    expect(last.result).toEqual({ text: 'Nothing was downloaded yet. Say which data you want, for example "Download employees and projects".' });
  });
});

describe('a download happens only when the latest message asks for one', () => {
  it('does not download again for a "thank you" after a download (reported from the Exports page)', async () => {
    const api = new FakeExportApi();
    const first = await run({ api, message: 'Download the documents and projects CSV', model: scriptedModel() });
    expect(paths(first.last)).toEqual(['/exports/documents', '/exports/projects']);
    // scriptedModel() with no replies fails the test if the model is called.
    const second = await run({ api, conversationId: first.conversationId, message: 'Thank you for making my work easy', model: scriptedModel() });
    expect(second.last.result).toEqual({ text: "You're welcome!" });
  });

  it('does not download modules the latest message never names, even when the model repeats them', async () => {
    const api = new FakeExportApi();
    const first = await run({ api, message: 'Download the documents and projects CSV' });
    const second = await run({
      api,
      conversationId: first.conversationId,
      message: 'You made my work so easy',
      model: scriptedModel(toolCall('export_csv', { modules: 'documents and projects' })),
    });
    expect(second.last.result).toEqual({ text: 'Nothing to download. Say which data you want, for example "Download employees and projects".' });
  });

  it('only offers data named in passing', async () => {
    const { last } = await run({ api: new FakeExportApi(), message: 'Projects are important to me', model: scriptedModel(toolCall('export_csv', { modules: 'projects' })) });
    expect(last.result).toMatchObject({ downloads: [{ path: '/exports/projects' }], autoDownload: false });
  });

  it('still downloads "the same again" and "I need …"', async () => {
    const api = new FakeExportApi();
    const first = await run({ api, message: 'Download projects' });
    const again = await run({ api, conversationId: first.conversationId, message: 'Same again please', model: scriptedModel(toolCall('export_csv', { modules: 'projects' })) });
    expect(again.last.result).toMatchObject({ downloads: [{ path: '/exports/projects' }], autoDownload: true });
  });
});

describe('chips and buttons', () => {
  it('lists what can be exported, and a button downloads straight away (4.6)', async () => {
    const api = new FakeExportApi(readRights('exports', 'employees', 'projects'));
    const first = await run({ user: employeeUser, api, toolCall: { name: 'export_csv', args: {} } });
    expect(first.last.result!.table!.rows).toEqual([
      { export: 'Employees', columns: 'Name, email, job title, department, role, status' },
      { export: 'Projects', columns: 'Name, description, deadline, status' },
    ]);
    const buttons = first.last.result!.buttons!;
    expect(buttons.map((b) => b.label)).toEqual(['Employees', 'Projects', 'All of them']);

    const second = await run({ user: employeeUser, api, conversationId: first.conversationId, toolCall: buttons[2].toolCall });
    expect(paths(second.last)).toEqual(['/exports/employees', '/exports/projects']);
    expect(second.last.result!.autoDownload).toBe(true);
  });

  it('offers both starter chips', () => {
    expect(exportsModule.starters.map((s) => s.label)).toEqual(['Download everything', 'What can I export?']);
  });
});
