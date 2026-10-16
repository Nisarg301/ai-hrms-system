import { describe, expect, it } from 'vitest';
import { can } from './can';

describe('can', () => {
  it('grants everything for scope "all"', () => {
    const perms = { scope: 'all' } as const;
    expect(can(perms, 'employees', 'read')).toBe(true);
    expect(can(perms, 'employees', 'delete')).toBe(true);
  });

  it('grants nothing for scope "none"', () => {
    expect(can({ scope: 'none' }, 'employees', 'read')).toBe(false);
  });

  it('grants nothing when perms is undefined', () => {
    expect(can(undefined, 'employees', 'read')).toBe(false);
  });

  it('reads the matrix entry for the module', () => {
    const perms = {
      scope: 'matrix' as const,
      entries: [{ module: 'employees' as const, read: true, create: true, update: false, delete: false }],
    };
    expect(can(perms, 'employees', 'read')).toBe(true);
    expect(can(perms, 'employees', 'create')).toBe(true);
    expect(can(perms, 'employees', 'update')).toBe(false);
    expect(can(perms, 'documents', 'read')).toBe(false);
  });

  it('denies a module outside the plan, even with full access', () => {
    const basicModules = ['dashboard', 'employees', 'documents', 'projects', 'tasks', 'departments'] as const;
    expect(can({ scope: 'all' }, 'exports', 'read', basicModules)).toBe(false);
    expect(can({ scope: 'all' }, 'auditLogs', 'read', basicModules)).toBe(false);
    expect(can({ scope: 'all' }, 'employees', 'delete', basicModules)).toBe(true);
    // An inactive plan unlocks nothing.
    expect(can({ scope: 'all' }, 'employees', 'read', [])).toBe(false);
  });

  it('still applies the role matrix inside the plan', () => {
    const perms = {
      scope: 'matrix' as const,
      entries: [{ module: 'exports' as const, read: true, create: false, update: false, delete: false }],
    };
    expect(can(perms, 'exports', 'read', ['exports', 'auditLogs'])).toBe(true);
    expect(can(perms, 'auditLogs', 'read', ['exports', 'auditLogs'])).toBe(false);
  });

  it('applies no plan restriction when plan modules are unknown', () => {
    expect(can({ scope: 'all' }, 'exports', 'read', undefined)).toBe(true);
  });

  it('enforces the read-gate: create/update/delete require read', () => {
    const perms = {
      scope: 'matrix' as const,
      entries: [{ module: 'employees' as const, read: false, create: true, update: true, delete: true }],
    };
    expect(can(perms, 'employees', 'create')).toBe(false);
    expect(can(perms, 'employees', 'update')).toBe(false);
    expect(can(perms, 'employees', 'delete')).toBe(false);
  });
});
