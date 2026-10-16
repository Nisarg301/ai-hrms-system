import { describe, expect, it } from 'vitest';
import { landingPath } from './landingPath';
import { activeSubscription, expiredSubscription, NO_PLAN } from '../test/fixtures';
import type { AuthUser, EffectivePermissions, UserRoleName } from '../types/auth';
import type { Subscription } from '../types/subscription';

const FULL: EffectivePermissions = { scope: 'all' };
const NONE: EffectivePermissions = { scope: 'none' };
const DASHBOARD_READ: EffectivePermissions = {
  scope: 'matrix',
  entries: [{ module: 'dashboard', read: true, create: false, update: false, delete: false }],
};
const NO_DASHBOARD: EffectivePermissions = {
  scope: 'matrix',
  entries: [{ module: 'employees', read: true, create: false, update: false, delete: false }],
};

function user(role: UserRoleName, permissions: EffectivePermissions, subscription: Subscription | null = activeSubscription()): AuthUser {
  return { id: 'u1', name: 'U', email: 'u@x.com', role, organizationId: 'o1', roleId: null, mustChangePassword: false, permissions, subscription };
}

describe('landingPath', () => {
  it('always sends a Super Admin to Admin Users', () => {
    expect(landingPath(user('SUPER_ADMIN', FULL, null))).toBe('/admin-users');
    expect(landingPath(user('SUPER_ADMIN', NONE, null))).toBe('/admin-users');
  });

  it('sends an Org Admin with an active plan to Home', () => {
    expect(landingPath(user('ORG_ADMIN', FULL))).toBe('/home');
    expect(landingPath(user('ORG_ADMIN', FULL, activeSubscription('basic')))).toBe('/home');
  });

  it('sends an Org Admin without an active plan to Billing', () => {
    expect(landingPath(user('ORG_ADMIN', FULL, NO_PLAN))).toBe('/billing');
    expect(landingPath(user('ORG_ADMIN', FULL, expiredSubscription()))).toBe('/billing');
    // No subscription data at all is treated as no plan.
    expect(landingPath(user('ORG_ADMIN', FULL, null))).toBe('/billing');
  });

  it('sends every Org User to Home, whatever their permissions', () => {
    expect(landingPath(user('ORG_USER', DASHBOARD_READ))).toBe('/home');
    expect(landingPath(user('ORG_USER', NO_DASHBOARD))).toBe('/home');
    expect(landingPath(user('ORG_USER', NONE))).toBe('/home');
  });
});
