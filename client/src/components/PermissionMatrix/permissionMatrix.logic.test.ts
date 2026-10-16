import { describe, expect, it } from 'vitest';
import { MODULES } from '../../constants/modules';
import {
  emptyMatrix,
  entriesToMatrix,
  globalState,
  matrixToEntries,
  rowState,
  setAction,
  setGlobalAll,
  setRowAll,
} from './permissionMatrix.logic';

describe('emptyMatrix', () => {
  it('has every module with every flag false', () => {
    const matrix = emptyMatrix();
    // Compared against MODULES so adding a module doesn't need a test edit.
    expect(Object.keys(matrix)).toEqual([...MODULES]);
    expect(matrix.employees).toEqual({ read: false, create: false, update: false, delete: false });
  });
});

describe('setAction — the mandatory-Read gate', () => {
  it('unchecking read clears create, update, and delete', () => {
    let matrix = emptyMatrix();
    matrix = setRowAll(matrix, 'employees', true);
    expect(matrix.employees).toEqual({ read: true, create: true, update: true, delete: true });

    matrix = setAction(matrix, 'employees', 'read', false);

    expect(matrix.employees).toEqual({ read: false, create: false, update: false, delete: false });
  });

  it('checking read does not grant any other action', () => {
    const matrix = setAction(emptyMatrix(), 'employees', 'read', true);
    expect(matrix.employees).toEqual({ read: true, create: false, update: false, delete: false });
  });

  it('refuses to set create when read is false', () => {
    const matrix = setAction(emptyMatrix(), 'employees', 'create', true);
    expect(matrix.employees.create).toBe(false);
    expect(matrix.employees.read).toBe(false);
  });

  it('sets create when read is true', () => {
    let matrix = setAction(emptyMatrix(), 'employees', 'read', true);
    matrix = setAction(matrix, 'employees', 'create', true);
    expect(matrix.employees).toEqual({ read: true, create: true, update: false, delete: false });
  });

  it('does not touch other modules', () => {
    const matrix = setAction(emptyMatrix(), 'employees', 'read', true);
    expect(matrix.projects).toEqual({ read: false, create: false, update: false, delete: false });
  });
});

describe('setRowAll', () => {
  it('checks all four flags', () => {
    const matrix = setRowAll(emptyMatrix(), 'tasks', true);
    expect(matrix.tasks).toEqual({ read: true, create: true, update: true, delete: true });
  });

  it('clears all four flags', () => {
    let matrix = setRowAll(emptyMatrix(), 'tasks', true);
    matrix = setRowAll(matrix, 'tasks', false);
    expect(matrix.tasks).toEqual({ read: false, create: false, update: false, delete: false });
  });
});

describe('rowState', () => {
  it('reports none, some, and all', () => {
    expect(rowState({ read: false, create: false, update: false, delete: false })).toBe('none');
    expect(rowState({ read: true, create: false, update: false, delete: false })).toBe('some');
    expect(rowState({ read: true, create: true, update: true, delete: true })).toBe('all');
  });
});

describe('setGlobalAll and globalState', () => {
  it('selects every permission on every module', () => {
    const matrix = setGlobalAll(emptyMatrix(), true);
    expect(globalState(matrix)).toBe('all');
    expect(matrix.dashboard).toEqual({ read: true, create: true, update: true, delete: true });
    expect(matrix.tasks).toEqual({ read: true, create: true, update: true, delete: true });
  });

  it('clears every permission on every module', () => {
    const matrix = setGlobalAll(setGlobalAll(emptyMatrix(), true), false);
    expect(globalState(matrix)).toBe('none');
    expect(matrix.dashboard).toEqual({ read: false, create: false, update: false, delete: false });
  });

  it('reports some when only part is selected', () => {
    const matrix = setRowAll(emptyMatrix(), 'tasks', true);
    expect(globalState(matrix)).toBe('some');
  });
});

describe('matrixToEntries / entriesToMatrix', () => {
  it('emits only modules with at least read, in the API payload shape', () => {
    let matrix = emptyMatrix();
    matrix = setAction(matrix, 'employees', 'read', true);
    matrix = setAction(matrix, 'employees', 'create', true);

    expect(matrixToEntries(matrix)).toEqual([
      { module: 'employees', read: true, create: true, update: false, delete: false },
    ]);
  });

  it('emits nothing when no module has read', () => {
    expect(matrixToEntries(emptyMatrix())).toEqual([]);
  });

  it('round-trips entries from the API back into a full matrix', () => {
    const entries = [{ module: 'projects' as const, read: true, create: false, update: true, delete: false }];
    const matrix = entriesToMatrix(entries);

    expect(matrix.projects).toEqual({ read: true, create: false, update: true, delete: false });
    expect(matrix.employees).toEqual({ read: false, create: false, update: false, delete: false });
    expect(matrixToEntries(matrix)).toEqual(entries);
  });
});

describe('limiting the matrix to the plan modules', () => {
  const BASIC = ['dashboard', 'employees', 'documents', 'projects', 'tasks', 'departments'] as const;

  it('select-all covers only the given modules and keeps the rest untouched', () => {
    const start = setRowAll(emptyMatrix(), 'auditLogs', true);
    const next = setGlobalAll(start, true, BASIC);
    expect(next.employees).toEqual({ read: true, create: true, update: true, delete: true });
    expect(next.exports).toEqual({ read: false, create: false, update: false, delete: false });
    expect(next.auditLogs).toEqual({ read: true, create: true, update: true, delete: true });
  });

  it('counts and sends only the given modules', () => {
    const matrix = setRowAll(setGlobalAll(emptyMatrix(), true, BASIC), 'exports', true);
    expect(globalState(matrix, BASIC)).toBe('all');
    expect(globalState(matrix)).toBe('some');
    expect(matrixToEntries(matrix, BASIC).map((e) => e.module)).toEqual([...BASIC]);
  });
});
