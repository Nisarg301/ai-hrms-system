import {
  asksForFilter,
  backedByUser,
  elsewhereNotes,
  formatNote,
  isQuestion,
  mentionsExport,
  plainRequest,
  readRequest,
} from '../../src/ai/modules/exports.helpers';

const ALL4 = ['employees', 'documents', 'projects', 'tasks'];

describe('readRequest', () => {
  it.each([
    ['Download the employees CSV', ['employees']],
    ['Download the CSV for employees, documents, projects and tasks', ALL4],
    ['export projects & tasks', ['projects', 'tasks']],
    ['staff and to-dos', ['employees', 'tasks']],
    ['Download everything', ALL4],
    ['Sab download kar do', ALL4],
    ['all employees', ['employees']],
    ['Download everything except documents', ['employees', 'projects', 'tasks']],
    ['all but tasks', ['employees', 'documents', 'projects']],
    ['employees and projects, not tasks', ['employees', 'projects']],
    ['everything except documents and tasks', ['employees', 'projects']],
    ['projects ke alawa sab', ['employees', 'documents', 'tasks']],
    ['sab download karo, documents chhodkar', ['employees', 'projects', 'tasks']],
  ])('%s', (text, modules) => {
    expect(readRequest(text).modules).toEqual(modules);
  });

  it('says whether "all" was asked for, and whether anything was named', () => {
    expect(readRequest('Download everything except documents')).toMatchObject({ everything: true, named: true });
    expect(readRequest('employees and projects')).toMatchObject({ everything: false, named: true });
    expect(readRequest('Download attendance')).toEqual({ modules: [], everything: false, named: false });
  });
});

describe('plainRequest', () => {
  it.each([
    'Download the CSV for employees, documents, projects and tasks',
    'Export projects and tasks',
    'Can you send me the staff and task data please?',
    'Mujhe employees aur projects ki CSV chahiye',
    'Projects ka data download karna hai',
    'Get me the documents file',
    'Sab download kar do',
    'Download everything except documents',
    'tasks',
  ])('reads "%s" without the model', (text) => {
    expect(plainRequest(text)).not.toBeNull();
  });

  it.each([
    ['a question', "What's in the tasks export?"],
    ['an unknown word', 'I need the project list for the board meeting'],
    ['a filter', 'Download only the active employees'],
    ['a typo', 'Download the emplyees list'],
    ['nothing exportable', 'Download attendance'],
    ['nothing named', 'Download'],
  ])('leaves %s to the model', (_what, text) => {
    expect(plainRequest(text)).toBeNull();
  });
});

describe("backing the model's reading with the user's words", () => {
  it('allows a small misspelling, but not a different word', () => {
    expect(mentionsExport('Download the emplyees list', 'employees')).toBe(true);
    expect(mentionsExport('the documnets please', 'documents')).toBe(true);
    expect(mentionsExport('my taks', 'tasks')).toBe(true);
    expect(mentionsExport('it takes a while', 'tasks')).toBe(false);
  });

  it('drops exports the user never named, and an "all" they never asked for', () => {
    // Verbatim from the eval: the model copied "all except documents" from its instructions.
    expect(backedByUser(readRequest('all except documents'), 'Download attendance').modules).toEqual([]);
    expect(backedByUser(readRequest('employees and projects'), 'Download attendance').modules).toEqual([]);
    expect(backedByUser(readRequest('employees'), 'Download the emplyees list').modules).toEqual(['employees']);
  });

  it('keeps what an earlier message asked for ("the same again")', () => {
    expect(backedByUser(readRequest('projects'), 'Download projects\nThe same again please').modules).toEqual(['projects']);
    expect(backedByUser(readRequest('everything'), 'Download everything\nAgain').modules).toHaveLength(4);
  });
});

describe('notes', () => {
  it('says where data from other pages is exported', () => {
    expect(elsewhereNotes('Download attendance and expenses', true)).toEqual([
      'Attendance is exported from the Team attendance page.',
      'Expenses are exported from the Claims tab of the Expenses page.',
    ]);
    expect(elsewhereNotes('Download attendance', false)).toEqual(['Attendance is exported from the Team attendance page (admins only).']);
    expect(elsewhereNotes('employees with their departments', true)).toEqual([
      "There's no Departments export, but the Employees CSV has each employee's department.",
    ]);
  });

  it('answers a format other than CSV', () => {
    expect(formatNote('Download projects as Excel')).toBe('CSV files open in Excel and Google Sheets.');
    expect(formatNote('Download projects as a PDF')).toBe('Exports are CSV only. CSV files open in Excel and Google Sheets.');
    expect(formatNote('Download projects')).toBeNull();
  });

  it('spots requests for only some rows', () => {
    expect(asksForFilter('only the active employees')).toBe(true);
    expect(asksForFilter('projects due this month')).toBe(true);
    expect(asksForFilter('Download employees')).toBe(false);
  });

  it('tells questions from requests', () => {
    expect(isQuestion("What's in the tasks export?")).toBe(true);
    expect(isQuestion('How do I download projects?')).toBe(true);
    expect(isQuestion('Can you download projects?')).toBe(false);
    expect(isQuestion('Do not download documents')).toBe(false);
    expect(isQuestion('Download projects')).toBe(false);
  });
});
