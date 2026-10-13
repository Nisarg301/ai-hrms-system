import { Types } from 'mongoose';
import { env } from '../config/env';
import { IUser } from '../models/user.model';
import { departmentRepository } from '../repositories/department.repository';
import { userRepository } from '../repositories/user.repository';
import { ApiError } from '../utils/apiResponse';
import { todayIso } from '../utils/dates';

/** Public avatar URL, or null. `v` busts the browser cache after a new upload. */
export function avatarUrl(user: IUser): string | null {
  if (!user.avatar?.id) return null;
  const version = user.updatedAt ? user.updatedAt.getTime() : Date.now();
  return `${env.API_BASE_URL}/api/v1/auth/avatar/${user._id}?v=${version}`;
}

/** The joining date an ORG_ADMIN set, else the (IST) day the account was created. */
export function effectiveJoiningDate(user: IUser): string {
  return user.joiningDate ?? todayIso(user.createdAt);
}

/** Active members of an organization: ORG_ADMINs and ORG_USERs, not disabled or deleted. */
export function activeMembers(organizationId: Types.ObjectId): Promise<IUser[]> {
  return userRepository.find({ organizationId, role: { $in: ['ORG_ADMIN', 'ORG_USER'] }, status: 'active' });
}

export type Person = ReturnType<typeof toPerson>;

/** The small, non-sensitive summary of a colleague used across Home, Me and Team. */
export function toPerson(user: IUser, departmentNames: Map<string, string>) {
  return {
    id: user._id.toString(),
    name: user.name,
    jobTitle: user.jobTitle,
    departmentName: user.department ? (departmentNames.get(user.department.toString()) ?? null) : null,
    avatarUrl: avatarUrl(user),
    role: user.role,
    reportsTo: user.reportsTo?.toString() ?? null,
    joiningDate: effectiveJoiningDate(user),
  };
}

export async function departmentNameMap(organizationId: Types.ObjectId): Promise<Map<string, string>> {
  const departments = await departmentRepository.find({ organizationId });
  return new Map(departments.map((d) => [d._id.toString(), d.title]));
}

/**
 * Checks a proposed manager for `employeeId` (null while the employee is being
 * created): an active member of the same organization, not the employee, and not
 * someone who already reports (directly or indirectly) to the employee.
 */
export async function assertValidManager(managerId: string, employeeId: string | null, organizationId: Types.ObjectId): Promise<void> {
  const fieldError = (message: string) => new ApiError(400, 'Validation failed', { fieldErrors: { reportsTo: [message] } });

  if (employeeId && managerId === employeeId) {
    throw fieldError('An employee cannot report to themselves');
  }
  const manager = await userRepository.findById(managerId, { organizationId, status: 'active', role: { $in: ['ORG_ADMIN', 'ORG_USER'] } });
  if (!manager) {
    throw new ApiError(404, 'Manager not found in your organization');
  }
  if (!employeeId) return;

  // Walk up the proposed manager's chain; meeting the employee means a loop.
  const seen = new Set<string>();
  let current: IUser | null = manager;
  while (current?.reportsTo) {
    const next = current.reportsTo.toString();
    if (next === employeeId) {
      throw fieldError('This would create a reporting loop');
    }
    if (seen.has(next)) break; // an existing loop in old data; don't spin
    seen.add(next);
    current = await userRepository.findById(next, { organizationId });
  }
}

export interface Team {
  manager: IUser | null;
  /** Colleagues who share my manager, by name. */
  peers: IUser[];
  /** People who report to me, by name. */
  directReports: IUser[];
}

/** My team in the reporting-manager model, picked out of the organization's active members. */
export function teamOf(me: IUser, members: IUser[]): Team {
  const myId = me._id.toString();
  const managerId = me.reportsTo?.toString() ?? null;
  const byName = (a: IUser, b: IUser) => a.name.localeCompare(b.name);
  return {
    manager: (managerId && members.find((m) => m._id.toString() === managerId)) || null,
    peers: managerId ? members.filter((m) => m.reportsTo?.toString() === managerId && m._id.toString() !== myId).sort(byName) : [],
    directReports: members.filter((m) => m.reportsTo?.toString() === myId).sort(byName),
  };
}

/** Everyone in the team, manager first. */
export function teamMembers(team: Team): IUser[] {
  return [...(team.manager ? [team.manager] : []), ...team.peers, ...team.directReports];
}
