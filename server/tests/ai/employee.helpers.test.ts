import {
  cleanCreateArgs,
  fillFromText,
  findEmails,
  grounded,
  looksLikeJobTitle,
  matchByName,
  mergeArgs,
  normalizeEmail,
  unsupportedDetails,
} from '../../src/ai/modules/employee.helpers';

const departments = [
  { id: 'd1', title: 'Engineering' },
  { id: 'd2', title: 'Human Resources' },
  { id: 'd3', title: 'Sales' },
  { id: 'd4', title: 'Sales Operations' },
];
const match = (q: string) => matchByName(departments, q, (d) => d.title, (d) => d.id);

describe('cleanCreateArgs', () => {
  it('drops blanks the model sends for fields the user never gave', () => {
    const said = 'Create an employee named Mike Johnson in Engineering.';
    const { args } = cleanCreateArgs({ name: 'Mike Johnson', department: 'Engineering', email: '', designation: '', jobTitle: null, role: 'N/A' }, said, said);
    expect(args).toEqual({ name: 'Mike Johnson', department: 'Engineering' });
  });

  it('clears a salary the model put into the job title, and reports it as not saved', () => {
    const said = 'Create an employee named Mike Johnson, email mike@company.com, department Engineering, and salary 75,000.';
    const { args, notSaved } = cleanCreateArgs({ name: 'Mike Johnson', email: 'mike@company.com', department: 'Engineering', jobTitle: 'salary 75,000' }, said, said);
    expect(args.jobTitle).toBeUndefined();
    expect(args.email).toBe('mike@company.com');
    expect(notSaved).toEqual(['salary']);
  });

  it('drops an email the user never wrote, so an invented one can never be saved', () => {
    const said = 'Add Mike Johnson to Engineering';
    expect(cleanCreateArgs({ name: 'Mike Johnson', email: 'mike.johnson@example.com' }, said, said).args.email).toBeUndefined();
  });

  it('accepts a spoken email', () => {
    const said = 'add priya shah, email priya at company dot com';
    expect(cleanCreateArgs({ name: 'Priya Shah', email: 'priya at company dot com' }, said, said).args.email).toBe('priya@company.com');
  });

  it('drops a name that is nowhere in what the user said', () => {
    const said = 'Create an employee from Mike';
    expect(cleanCreateArgs({ name: 'John Doe', copyFrom: 'Mike' }, said, said).args).toEqual({ copyFrom: 'Mike' });
  });

  it('turns otherDetails into "not saved" labels', () => {
    const said = 'Add Priya Shah as a QA Engineer in Engineering, priya@company.com, salary 6 lakh, phone 9876543210';
    const { notSaved } = cleanCreateArgs({ name: 'Priya Shah', otherDetails: 'salary 6 lakh, phone 9876543210' }, said, said);
    expect(notSaved.sort()).toEqual(['phone number', 'salary']);
  });
});

describe('matchByName', () => {
  it('matches exactly, ignoring case and the word "department"', () => {
    expect(match('engineering department')).toEqual({ kind: 'one', item: departments[0] });
  });

  it('matches initials: "HR" is Human Resources', () => {
    expect(match('HR')).toEqual({ kind: 'one', item: departments[1] });
  });

  it('matches a unique prefix', () => {
    expect(match('Eng')).toEqual({ kind: 'one', item: departments[0] });
  });

  it('prefers the exact name over longer ones that start the same', () => {
    expect(match('Sales')).toEqual({ kind: 'one', item: departments[2] });
  });

  it('reports several matches instead of guessing', () => {
    expect(match('sal').kind).toBe('many');
  });

  it('finds nothing for a job title used as a role', () => {
    const roles = [{ id: 'r1', name: 'Employee' }, { id: 'r2', name: 'Manager' }];
    expect(matchByName(roles, 'QA Engineer', (r) => r.name, (r) => r.id)).toEqual({ kind: 'none' });
  });

  it('matches by id', () => {
    expect(match('d3')).toEqual({ kind: 'one', item: departments[2] });
  });
});

describe('emails and details', () => {
  it('finds typed and spoken emails', () => {
    expect(findEmails('mike@Company.com, and also sara at company dot co dot in')).toEqual(['mike@company.com', 'sara@company.co.in']);
  });

  it('normalizes a single email or rejects non-emails', () => {
    expect(normalizeEmail(' Mike@Company.COM ')).toBe('mike@company.com');
    expect(normalizeEmail('mike')).toBeNull();
  });

  it('spots details the record cannot store', () => {
    expect(unsupportedDetails('salary 75,000 and his mobile is 98765')).toEqual(['salary', 'phone number']);
    expect(unsupportedDetails('Software Engineer in Engineering')).toEqual([]);
  });

  it('knows a job title from a salary', () => {
    expect(looksLikeJobTitle('Software Engineer')).toBe(true);
    expect(looksLikeJobTitle('salary 75,000')).toBe(false);
    expect(looksLikeJobTitle('CTC 6 lakh')).toBe(false);
  });

  it('checks a name against what the user said, in any script', () => {
    expect(grounded('Mike Johnson', 'create mike in sales')).toBe(true);
    expect(grounded('John Doe', 'create mike in sales')).toBe(false);
    expect(grounded('प्रिया शाह', 'प्रिया शाह को जोड़ो')).toBe(true);
  });
});

describe('mergeArgs', () => {
  it('keeps earlier details the model dropped, and lets new ones win', () => {
    expect(mergeArgs<Record<string, string>>({ name: 'Priya Shah', department: 'd1' }, { email: 'priya@company.com', department: '', jobTitle: 'QA' })).toEqual({
      name: 'Priya Shah',
      department: 'd1',
      email: 'priya@company.com',
      jobTitle: 'QA',
    });
  });
});

describe('fillFromText (follow-up fast path)', () => {
  const options = { departments: ['Engineering', 'Human Resources'], roles: ['Employee', 'Manager'] };

  it('takes an email reply', () => {
    expect(fillFromText(['email'], 'mike@company.com', options)).toEqual({ email: 'mike@company.com' });
  });

  it('takes department and role names said word for word', () => {
    expect(fillFromText(['department', 'role'], 'Engineering, as an Employee', options)).toEqual({ department: 'Engineering', role: 'Employee' });
  });

  it('takes a short reply as the one missing job title', () => {
    expect(fillFromText(['jobTitle'], 'He is a Software Engineer.', options)).toEqual({ jobTitle: 'Software Engineer' });
  });

  it('leaves mixed free text to the model', () => {
    expect(fillFromText(['email', 'jobTitle'], 'mike@company.com, he is a Software Engineer', options)).toEqual({ email: 'mike@company.com' });
  });

  it('does not strip "An" from a name', () => {
    expect(fillFromText(['name'], 'An Nguyen', options)).toEqual({ name: 'An Nguyen' });
  });
});
