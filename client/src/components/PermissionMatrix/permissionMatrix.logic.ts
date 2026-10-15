import { MODULES } from '../../constants/modules';
import type { ModuleName, PermissionAction, PermissionEntry, PermissionFlags, PermissionMatrixValue } from '../../types/role';

export type SelectionState = 'none' | 'some' | 'all';

const NO_FLAGS: PermissionFlags = { read: false, create: false, update: false, delete: false };
const ALL_FLAGS: PermissionFlags = { read: true, create: true, update: true, delete: true };

export function emptyMatrix(): PermissionMatrixValue {
  return MODULES.reduce((acc, module) => {
    acc[module] = { ...NO_FLAGS };
    return acc;
  }, {} as PermissionMatrixValue);
}

/**
 * Read is a gate, not just another flag: without it the backend refuses
 * create/update/delete, so the UI must never let them be set independently.
 */
export function setAction(
  value: PermissionMatrixValue,
  module: ModuleName,
  action: PermissionAction,
  checked: boolean
): PermissionMatrixValue {
  const current = value[module];

  if (action === 'read') {
    // Turning read off drops the actions it was gating.
    const next: PermissionFlags = checked ? { ...current, read: true } : { ...NO_FLAGS };
    return { ...value, [module]: next };
  }

  // A non-read action is only settable while read is on.
  if (!current.read) {
    return value;
  }

  return { ...value, [module]: { ...current, [action]: checked } };
}

export function setRowAll(value: PermissionMatrixValue, module: ModuleName, checked: boolean): PermissionMatrixValue {
  return { ...value, [module]: checked ? { ...ALL_FLAGS } : { ...NO_FLAGS } };
}

/**
 * The editable modules are the organization's plan modules; everything below takes
 * them as `modules` (default: all) so hidden modules are never shown, counted or sent.
 */
export function setGlobalAll(
  value: PermissionMatrixValue,
  checked: boolean,
  modules: readonly ModuleName[] = MODULES
): PermissionMatrixValue {
  const next = { ...value };
  for (const module of modules) {
    next[module] = checked ? { ...ALL_FLAGS } : { ...NO_FLAGS };
  }
  return next;
}

function countChecked(flags: PermissionFlags): number {
  return [flags.read, flags.create, flags.update, flags.delete].filter(Boolean).length;
}

/** Derived, never stored — the row checkbox reflects the flags rather than owning state. */
export function rowState(flags: PermissionFlags): SelectionState {
  const checked = countChecked(flags);
  if (checked === 0) return 'none';
  if (checked === 4) return 'all';
  return 'some';
}

export function globalState(value: PermissionMatrixValue, modules: readonly ModuleName[] = MODULES): SelectionState {
  const total = modules.length * 4;
  const checked = modules.reduce((sum, module) => sum + countChecked(value[module]), 0);
  if (checked === 0) return 'none';
  if (checked === total) return 'all';
  return 'some';
}

/**
 * A module with read:false grants nothing, so it is omitted from the payload
 * rather than sent as an all-false row.
 */
export function matrixToEntries(value: PermissionMatrixValue, modules: readonly ModuleName[] = MODULES): PermissionEntry[] {
  return modules.filter((module) => value[module].read).map((module) => ({ module, ...value[module] }));
}

export function entriesToMatrix(entries: PermissionEntry[]): PermissionMatrixValue {
  const matrix = emptyMatrix();
  for (const entry of entries) {
    matrix[entry.module] = {
      read: entry.read,
      create: entry.create,
      update: entry.update,
      delete: entry.delete,
    };
  }
  return matrix;
}
