import { zodToJsonSchema } from 'zod-to-json-schema';
import { hasPermission } from '../permissions/checkPermission';
import { roleRepository } from '../repositories/role.repository';
import { SubscriptionState } from '../services/subscription.service';
import { AuthenticatedUser } from '../types/express';
import { departmentModule } from './modules/department.module';
import { documentModule } from './modules/document.module';
import { employeeModule } from './modules/employee.module';
import { attendanceModule } from './modules/attendance.module';
import { auditLogModule } from './modules/auditLog.module';
import { expenseModule } from './modules/expense.module';
import { exportsModule } from './modules/exports.module';
import { leaveModule } from './modules/leave.module';
import { myExpenseModule } from './modules/myExpense.module';
import { navigationModule } from './modules/navigation.module';
import { projectModule } from './modules/project.module';
import { roleModule } from './modules/role.module';
import { taskModule } from './modules/task.module';
import { ModelTool } from './ollama.client';
import { AiModule, AiTool } from './types';

// The Navigation assistant is for pages without an assistant of their own; every other one opens pages too.
const MODULES: AiModule[] = [employeeModule, projectModule, departmentModule, exportsModule, taskModule, documentModule, roleModule, expenseModule, leaveModule, attendanceModule, myExpenseModule, auditLogModule, navigationModule];

export const AI_MODULE_KEYS = MODULES.map((m) => m.key) as [string, ...string[]];

export function getModule(key: string): AiModule | undefined {
  return MODULES.find((m) => m.key === key);
}

async function roleOf(user: AuthenticatedUser) {
  return user.role !== 'ORG_ADMIN' && user.roleId ? roleRepository.findById(user.roleId) : null;
}

/**
 * The tools this user may use: admin-only tools for ORG_ADMIN, and tools that need a
 * permission-matrix action only when the user's role grants it. Others are never even
 * shown to the model; the API checks again anyway.
 */
export async function allowedTools(module: AiModule, user: AuthenticatedUser): Promise<AiTool[]> {
  const permissionModule = module.requiredPermission?.module;
  const needsRole = user.role !== 'ORG_ADMIN' && module.tools.some((t) => t.requires);
  const role = needsRole ? await roleOf(user) : null;
  return module.tools.filter(
    (t) =>
      (!t.adminOnly || user.role === 'ORG_ADMIN') &&
      (!t.requires || (permissionModule !== undefined && hasPermission(user, role, permissionModule, t.requires)))
  );
}

/** Whether this user may open the module at all: its plan feature and its permission-matrix right. */
export async function canUseModule(module: AiModule, user: AuthenticatedUser, subscription?: SubscriptionState): Promise<boolean> {
  if (module.adminOnly && user.role !== 'ORG_ADMIN') return false;
  if (module.requiredFeature && !subscription?.features.includes(module.requiredFeature)) return false;
  if (module.requiredPermission) {
    const { module: name, action } = module.requiredPermission;
    if (subscription && !subscription.modules.includes(name)) return false;
    if (user.role !== 'ORG_ADMIN' && !hasPermission(user, await roleOf(user), name, action)) return false;
  }
  return true;
}

export async function usableModules(user: AuthenticatedUser, subscription?: SubscriptionState): Promise<AiModule[]> {
  const usable: AiModule[] = [];
  for (const module of MODULES) if (await canUseModule(module, user, subscription)) usable.push(module);
  return usable;
}

// Typed loosely: zod-to-json-schema's generics recurse too deep on these tool schemas.
const toJsonSchema = zodToJsonSchema as unknown as (schema: unknown, options: Record<string, unknown>) => Record<string, unknown>;
const toolJsonCache = new Map<string, ModelTool[]>();

/** The tool list sent to Ollama. Built once per set of tools, in a fixed order, so the prompt cache holds. */
export function modelToolsFor(module: AiModule, tools: AiTool[]): ModelTool[] {
  const key = `${module.key}:${tools.map((t) => t.name).join(',')}`;
  let json = toolJsonCache.get(key);
  if (!json) {
    json = tools.map((t) => {
      const { $schema: _schema, additionalProperties: _extra, ...parameters } = toJsonSchema(t.input, { target: 'openApi3', $refStrategy: 'none' });
      return { type: 'function' as const, function: { name: t.name, description: t.description, parameters } };
    });
    toolJsonCache.set(key, json);
  }
  return json;
}
