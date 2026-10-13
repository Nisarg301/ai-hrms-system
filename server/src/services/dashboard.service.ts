import { Types } from 'mongoose';
import { AuthenticatedUser } from '../types/express';
import { userRepository } from '../repositories/user.repository';
import { documentRepository } from '../repositories/document.repository';
import { projectRepository } from '../repositories/project.repository';
import { taskRepository } from '../repositories/task.repository';
import { roleRepository } from '../repositories/role.repository';
import { hasPermission } from '../permissions/checkPermission';

export interface ModuleCounts {
  employees: number | null;
  documents: number | null;
  projects: number | null;
  tasks: number | null;
}

/**
 * Record counts per module, null for any module the user can't read. With
 * `requireDashboard`, returns null outright unless the user can read the dashboard
 * (for Home, which every member sees; the /dashboard route checks this itself).
 */
export async function moduleCounts(
  user: AuthenticatedUser,
  organizationId: Types.ObjectId,
  options: { requireDashboard?: boolean } = {}
): Promise<ModuleCounts | null> {
  const role = user.roleId ? await roleRepository.findById(user.roleId) : null;
  if (options.requireDashboard && !hasPermission(user, role, 'dashboard', 'read')) {
    return null;
  }
  const [employees, documents, projects, tasks] = await Promise.all([
    hasPermission(user, role, 'employees', 'read') ? userRepository.count({ organizationId, role: 'ORG_USER' }) : Promise.resolve(null),
    hasPermission(user, role, 'documents', 'read') ? documentRepository.count({ organizationId }) : Promise.resolve(null),
    hasPermission(user, role, 'projects', 'read') ? projectRepository.count({ organizationId }) : Promise.resolve(null),
    hasPermission(user, role, 'tasks', 'read') ? taskRepository.count({ organizationId }) : Promise.resolve(null),
  ]);
  return { employees, documents, projects, tasks };
}
