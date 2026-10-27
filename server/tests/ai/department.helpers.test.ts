import { cleanDepartmentArgs, fillDepartmentFromText, statusesIn, statusFromWords } from '../../src/ai/modules/department.helpers';

describe('statusFromWords', () => {
  it.each([
    ['active', 'active'],
    ['inactive', 'inactive'],
    ['Deactivate it', 'inactive'],
    ['de-activate', 'inactive'],
    ['not active', 'inactive'],
    ['not in use any more', 'inactive'],
    ['disabled', 'inactive'],
    ['archive', 'inactive'],
    ['reactivate', 'active'],
    ['make it active again', 'active'],
    ['enable', 'active'],
  ])('%s -> %s', (words, status) => {
    expect(statusFromWords(words)).toBe(status);
  });

  it('returns null for words that name no status', () => {
    expect(statusFromWords('purple')).toBeNull();
  });
});

describe('statusesIn', () => {
  it('finds every status the user mentioned, without counting "not active" as active', () => {
    expect(statusesIn('Move Sales from inactive back to active')).toEqual(['inactive', 'active']);
    expect(statusesIn('Sales is not active any more')).toEqual(['inactive']);
    expect(statusesIn('Deactivate Sales')).toEqual(['inactive']);
    expect(statusesIn('Rename HR to People Operations')).toEqual([]);
  });
});

describe('cleanDepartmentArgs', () => {
  it('drops blanks and a description the user never gave', () => {
    expect(cleanDepartmentArgs({ name: 'Design', description: 'Creative work for clients', status: '' }, 'Create a department called Design')).toEqual({ name: 'Design' });
  });

  it('reads a stray title as the name', () => {
    expect(cleanDepartmentArgs({ title: 'Design' }, 'New department Design')).toEqual({ name: 'Design' });
  });

  it('drops "department" the model added to the name, but keeps it when the user said it', () => {
    expect(cleanDepartmentArgs({ name: 'Design Department' }, 'Create a department called Design').name).toBe('Design');
    expect(cleanDepartmentArgs({ name: 'Design Department' }, 'Create the Design Department').name).toBe('Design Department');
  });

  it('drops an invented name', () => {
    expect(cleanDepartmentArgs({ name: 'Marketing' }, 'Create a department for product design')).toEqual({});
  });
});

describe('fillDepartmentFromText', () => {
  it('takes the reply as the one missing description or name', () => {
    expect(fillDepartmentFromText(['description'], 'Product and brand design.')).toEqual({ description: 'Product and brand design' });
    expect(fillDepartmentFromText(['description'], 'It handles hiring and payroll')).toEqual({ description: 'hiring and payroll' });
    expect(fillDepartmentFromText(['name'], 'Call it Design')).toEqual({ name: 'Design' });
  });

  it('leaves a new request, or more than one missing field, to the model', () => {
    expect(fillDepartmentFromText(['description'], 'Show all departments')).toBeNull();
    expect(fillDepartmentFromText(['description'], 'cancel')).toBeNull();
    expect(fillDepartmentFromText(['name', 'description'], 'Design')).toBeNull();
  });
});
