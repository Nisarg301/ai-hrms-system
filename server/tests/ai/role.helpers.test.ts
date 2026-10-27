import { MODULES } from '../../src/constants/modules';
import {
  applyClauses,
  asksToCreate,
  cleanRoleName,
  entriesOf,
  fillRoleFromReply,
  Matrix,
  matrixOf,
  matrixText,
  permissionStatement,
  permissionText,
  readClauses,
  roleNameFrom,
} from '../../src/ai/modules/role.helpers';

const ALL_PLAN = [...MODULES];
const BASIC = ALL_PLAN.filter((m) => m !== 'exports' && m !== 'auditLogs');

/** The phrase read the way create_role and update_role read it. */
function read(message: string, name: string, base: Matrix = {}, plan = ALL_PLAN) {
  const applied = applyClauses(base, readClauses(permissionText(message, [name])), plan);
  return { ...applied, text: matrixText(applied.matrix, plan) };
}

const HR_MANAGER = matrixOf([
  { module: 'employees', read: true, create: true, update: true, delete: false },
  { module: 'documents', read: true, create: true, update: true, delete: true },
  { module: 'projects', read: true, create: false, update: false, delete: false },
]);

describe('reading permissions (section 2)', () => {
  it('pairs actions with modules, in either order, over several clauses', () => {
    expect(read('Create a role HR Manager with read, create and update on employees, select all on documents and read on projects', 'HR Manager').text).toBe(
      'Employees: Read, Create, Update · Documents: all · Projects: Read'
    );
    expect(read('employees: read and create; projects: read', '').text).toBe('Employees: Read, Create · Projects: Read');
    expect(read('Create Team Lead role with tasks with read and update and projects with read', 'Team Lead').text).toBe('Projects: Read · Tasks: Read, Update');
  });

  it('gives every module of the plan all four for "all permissions"', () => {
    expect(read('Create a role Auditor with all permissions', 'Auditor').text).toBe(
      'Dashboard: all · Employees: all · Documents: all · Projects: all · Tasks: all · Departments: all · Exports: all · Audit Logs: all'
    );
    expect(read('Create a role Viewer with read access to everything', 'Viewer').text).toMatch(/^Dashboard: Read · Employees: Read · .* · Audit Logs: Read$/);
    expect(read('Make a role Auditor and select all permissions', 'Auditor', {}, BASIC).text).not.toMatch(/Exports/);
  });

  it('takes "except" away from "all permissions"', () => {
    expect(read('Create a role X with all permissions except delete on audit logs', 'X').matrix.auditLogs).toEqual({ read: true, create: true, update: true, delete: false });
  });

  it('adds Read where another action needs it, with a note', () => {
    const r = read('Create a role Writer with create and update on tasks', 'Writer');
    expect(r.text).toBe('Tasks: Read, Create, Update');
    expect(r.notes).toEqual(['Read is added for Tasks: Create, Update and Delete need it.']);
  });

  it('leaves out modules outside the plan, with a note', () => {
    const r = read('Create a role Ops with read on exports and tasks', 'Ops', {}, BASIC);
    expect(r.text).toBe('Tasks: Read');
    expect(r.notes).toEqual(['Not in your plan, so left out: Exports.']);
  });

  it('asks which modules for actions with none', () => {
    const r = read('Create a role Viewer with read only', 'Viewer');
    expect(r.question).toBe('Which modules should get Read? Name them, or say "all modules".');
    expect(r.text).toBe('No permissions');
  });

  it('reads module words people use', () => {
    expect(read('Create role Helper with view on staff, edit on docs and full access to to-dos and audit', 'Helper').text).toBe(
      'Employees: Read · Documents: Read, Update · Tasks: all · Audit Logs: all'
    );
  });
});

describe('updating permissions (section 4.3)', () => {
  it('sets only the modules the message names', () => {
    expect(read('Update the HR Manager role with read and update on tasks', 'HR Manager', HR_MANAGER).text).toBe(
      'Employees: Read, Create, Update · Documents: all · Projects: Read · Tasks: Read, Update'
    );
  });

  it('adds with give, and takes away with remove and take away', () => {
    expect(read('Give delete on employees to HR Manager', 'HR Manager', HR_MANAGER).matrix.employees).toEqual({ read: true, create: true, update: true, delete: true });
    expect(read('Add delete on projects for HR Manager', 'HR Manager', HR_MANAGER).matrix.projects).toEqual({ read: true, create: false, update: false, delete: true });
    expect(read('Remove create from documents for HR Manager', 'HR Manager', HR_MANAGER).matrix.documents).toEqual({ read: true, create: false, update: true, delete: true });
    expect(read('Take away projects from HR Manager', 'HR Manager', HR_MANAGER).matrix.projects).toEqual({ read: false, create: false, update: false, delete: false });
    expect(read('Remove access to documents for HR Manager', 'HR Manager', HR_MANAGER).matrix.documents!.read).toBe(false);
  });

  it('clears the row when Read is taken away', () => {
    expect(read('Revoke read on documents from HR Manager', 'HR Manager', HR_MANAGER).matrix.documents).toEqual({ read: false, create: false, update: false, delete: false });
  });

  it('reads "add" and "remove" as actions after "can" or another action', () => {
    expect(read('HR Manager can add and remove tasks', 'HR Manager', HR_MANAGER).matrix.tasks).toEqual({ read: true, create: true, update: false, delete: true });
    expect(read('Update HR Manager: view, add and remove on projects', 'HR Manager', HR_MANAGER).matrix.projects).toEqual({ read: true, create: true, update: false, delete: true });
  });

  it('sends only modules with Read, as the page does', () => {
    const r = read('Take away projects from HR Manager', 'HR Manager', HR_MANAGER);
    expect(entriesOf(r.matrix, ALL_PLAN).map((e) => e.module)).toEqual(['employees', 'documents']);
  });
});

describe('names and replies', () => {
  it('finds the role name in the message', () => {
    expect(roleNameFrom('Create a role HR Manager with read on employees')).toBe('HR Manager');
    expect(roleNameFrom('Create a role called Team Lead that can read tasks')).toBe('Team Lead');
    expect(roleNameFrom('Update the Auditor role with read on exports')).toBe('Auditor');
    expect(roleNameFrom('Create Team Lead role with tasks with read')).toBe('Team Lead');
    expect(roleNameFrom('Create a new role')).toBeUndefined();
    expect(cleanRoleName('the "Support Agent" role with read on tasks')).toBe('Support Agent');
  });

  it('tells a new role from a permission action', () => {
    expect(asksToCreate('Create a role Auditor')).toBe(true);
    expect(asksToCreate('Set up a new role for interns')).toBe(true);
    expect(asksToCreate('Create and update on tasks for HR Manager')).toBe(false);
    expect(asksToCreate('Add delete on tasks to HR Manager')).toBe(false);
    expect(asksToCreate('Give create on tasks to HR Manager')).toBe(false);
  });

  it('fills a waiting draft from a plain reply', () => {
    expect(fillRoleFromReply(['name'], 'Support Agent')).toEqual({ name: 'Support Agent' });
    expect(fillRoleFromReply(['name'], 'Read on tasks')).toBeNull();
    expect(fillRoleFromReply(['permissions'], 'read on employees and projects')).toEqual({ permissions: 'read on employees and projects' });
    expect(fillRoleFromReply(['permissions'], 'None')).toEqual({ permissions: 'none' });
    expect(fillRoleFromReply(['permissions'], 'employees and projects', 'with read only')).toEqual({ permissions: 'with read only employees and projects' });
    expect(fillRoleFromReply(['name', 'permissions'], 'Auditor with all permissions')).toEqual({ name: 'Auditor', permissions: 'all permissions' });
    expect(fillRoleFromReply(['name', 'permissions'], 'Auditor')).toEqual({ name: 'Auditor' });
    expect(fillRoleFromReply(['name'], 'Show all roles')).toBeNull();
    expect(fillRoleFromReply(['permissions'], 'cancel')).toBeNull();
  });
});

describe('command words around the permissions', () => {
  it('reads "remove the create permission" and "delete the update permission" as taking away', () => {
    expect(read('Remove the create permission from documents for HR Manager', 'HR Manager', HR_MANAGER).matrix.documents).toEqual({ read: true, create: false, update: true, delete: true });
    expect(read('Delete the update permission on employees for HR Manager', 'HR Manager', HR_MANAGER).matrix.employees).toEqual({ read: true, create: true, update: false, delete: false });
  });

  it('finds no permissions in a plain delete', () => {
    expect(readClauses(permissionText('Delete the HR Manager role', ['HR Manager']))).toEqual([]);
    expect(readClauses(permissionText('Remove Auditor', ['Auditor']))).toEqual([]);
    expect(readClauses(permissionText('Remove the HR Manager role', ['HR Manager']))).toEqual([]);
  });
});

describe('permission changes the server reads on its own', () => {
  it('names the role for a change said outright', () => {
    expect(permissionStatement('Select all permissions for the Auditor role')).toBe('Auditor');
    expect(permissionStatement('Give the HR Manager role delete on tasks')).toBe('HR Manager');
    expect(permissionStatement('HR Manager role ko tasks ka read access do')).toBe('HR Manager');
  });

  it('leaves everything else to the model', () => {
    expect(permissionStatement('Delete the Auditor role')).toBeNull();
    expect(permissionStatement('What can the HR Manager role do?')).toBeNull();
    expect(permissionStatement('Create a Team Lead role with read on tasks')).toBeNull();
    expect(permissionStatement('Give delete on employees to HR Manager')).toBeNull();
    expect(permissionStatement('give the auditor role all permissions')).toBeNull();
  });
});
