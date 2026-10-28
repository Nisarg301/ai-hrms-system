import { Types } from 'mongoose';
import { AiEvent, ChatMessageView, runTurn } from '../../src/ai/agent.service';
import { ApiCallError } from '../../src/ai/apiClient';
import { employeeModule } from '../../src/ai/modules/employee.module';
import { deadlineDay, deadlineInstant, ProjectStatus } from '../../src/ai/modules/project.helpers';
import { ModelClient, ModelMessage, ModelReply } from '../../src/ai/ollama.client';
import { AiModule, ApiCall, ApiClient, UploadedFile } from '../../src/ai/types';
import { AiConversationModel, IAiConversation } from '../../src/models/aiConversation.model';
import { PLAN_MODULES } from '../../src/constants/modules';
import { EffectivePermissions } from '../../src/permissions/effectivePermissions';
import { AuthenticatedUser } from '../../src/types/express';
import { SubscriptionState } from '../../src/services/subscription.service';

// Whole chat turns against a scripted model and an in-memory stand-in for the REST API.
// Conversations are real Mongoose documents; only findOne/save are kept off the database.

export const id = () => new Types.ObjectId().toString();
export const ORG = id();
export const admin: AuthenticatedUser = { id: id(), organizationId: ORG, role: 'ORG_ADMIN', roleId: null, name: 'Nisarg' };
export const employeeUser: AuthenticatedUser = { id: id(), organizationId: ORG, role: 'ORG_USER', roleId: id(), name: 'Priya' };

export const D_ENG = id();
export const D_HR = id();
export const R_EMP = id();
export const R_MGR = id();

export interface Row {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
  department: string | null;
  departmentName: string | null;
  roleId: string | null;
  roleName: string | null;
  status: 'active' | 'disabled';
  reportsTo: string | null;
  reportsToName: string | null;
  joiningDate: string | null;
  dateOfBirth: string | null;
}

export function row(name: string, email: string, department = D_ENG, extra: Partial<Row> = {}): Row {
  return {
    id: id(),
    name,
    email,
    jobTitle: 'Software Engineer',
    department,
    departmentName: department === D_ENG ? 'Engineering' : 'HR',
    roleId: R_EMP,
    roleName: 'Employee',
    status: 'active',
    reportsTo: null,
    reportsToName: null,
    joiningDate: '2026-01-05',
    dateOfBirth: null,
    ...extra,
  };
}

/** Enough of the REST API for the employee tools, recording every call. */
export class FakeApi implements ApiClient {
  calls: ApiCall[] = [];
  departments = [
    { id: D_ENG, title: 'Engineering' },
    { id: D_HR, title: 'HR' },
  ];
  roles = [
    { id: R_EMP, name: 'Employee' },
    { id: R_MGR, name: 'Manager' },
  ];
  directReports = new Map<string, { id: string; name: string }[]>();
  constructor(public employees: Row[] = []) {}

  async get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return (await this.page<T>(path, query)).data;
  }

  async page<T>(path: string, query: Record<string, unknown> = {}) {
    this.calls.push({ method: 'GET', path, query });
    const ok = (data: unknown, total?: number) => ({ data: data as T, meta: { total } });
    if (path === '/departments') return ok(this.departments);
    if (path === '/roles') return ok(this.roles);
    if (path === '/employees') {
      const q = String(query.search ?? '').toLowerCase();
      const matches = this.employees.filter(
        (e) =>
          (!q || e.name.toLowerCase().includes(q) || e.email.includes(q)) &&
          (!query.department || e.department === query.department) &&
          (!query.status || e.status === query.status)
      );
      const limit = Number(query.limit ?? 10);
      const page = Number(query.page ?? 1);
      return ok(matches.slice((page - 1) * limit, page * limit), matches.length);
    }
    if (path === '/people/search') return ok(this.employees.filter((e) => e.name.toLowerCase().includes(String(query.q).toLowerCase())));
    const person = /^\/people\/(\w+)$/.exec(path);
    if (person) {
      const e = this.find(person[1]);
      return ok({ ...e, directReports: this.directReports.get(e.id) ?? [] });
    }
    const one = /^\/employees\/(\w+)$/.exec(path);
    if (one) return ok(this.find(one[1]));
    throw new Error(`Unexpected GET ${path}`);
  }

  async send<T>(call: ApiCall): Promise<T> {
    if (call.method === 'GET') return this.get<T>(call.path, call.query);
    this.calls.push(call);
    const body = (call.body ?? {}) as Record<string, string>;
    if (call.method === 'POST' && call.path === '/employees') {
      const created = row(body.name, body.email, body.department, { jobTitle: body.jobTitle, roleId: body.roleId });
      this.employees.push(created);
      return { user: created, temp_password: 'Temp#Secret123' } as T;
    }
    const target = /^\/employees\/(\w+)$/.exec(call.path);
    if (target && call.method === 'PUT') {
      const e = this.find(target[1]);
      Object.assign(e, body);
      if (body.department) e.departmentName = this.departments.find((d) => d.id === body.department)!.title;
      return e as T;
    }
    if (target && call.method === 'DELETE') {
      this.employees = this.employees.filter((e) => e.id !== target[1]);
      return { id: target[1], deleted: true } as T;
    }
    throw new Error(`Unexpected ${call.method} ${call.path}`);
  }

  private find(employeeId: string): Row {
    const e = this.employees.find((x) => x.id === employeeId);
    if (!e) throw new ApiCallError(404, 'Employee not found');
    return e;
  }

  writes() {
    return this.calls.filter((c) => c.method !== 'GET');
  }
}

/** Replies in order; any extra model call fails the test. */
export function scriptedModel(...replies: ModelReply[]): ModelClient & { seen: ModelMessage[][] } {
  const seen: ModelMessage[][] = [];
  return {
    seen,
    async chat({ messages }) {
      seen.push(messages);
      const next = replies.shift();
      if (!next) throw new Error('Unexpected model call');
      return next;
    },
  };
}
export const toolCall = (name: string, args: Record<string, unknown>): ModelReply => ({ content: '', toolCalls: [{ name, args }] });

// ---- persistence stand-in
export const stored = new Map<string, IAiConversation>();

/** Call at the top of a test file: conversations live in `stored` instead of MongoDB. */
export function stubPersistence(): void {
  beforeEach(() => {
    stored.clear();
    jest.spyOn(AiConversationModel, 'findOne').mockImplementation(((filter: Record<string, unknown>) => {
      const actionId = filter['pendingActions._id'];
      const found = [...stored.values()].find(
        (c) =>
          String(c.userId) === String(filter.userId) &&
          (filter._id ? String(c._id) === String(filter._id) : true) &&
          (actionId ? c.pendingActions.some((a) => String(a._id) === String(actionId)) : true)
      );
      return Promise.resolve(found ?? null);
    }) as never);
    jest.spyOn(AiConversationModel.prototype, 'save').mockImplementation(function (this: IAiConversation) {
      stored.set(String(this._id), this);
      return Promise.resolve(this);
    } as never);
  });
  afterEach(() => jest.restoreAllMocks());
}

export interface TurnOptions {
  module?: AiModule;
  user?: AuthenticatedUser;
  api: ApiClient;
  model?: ModelClient;
  message?: string;
  toolCall?: { name: string; args: Record<string, unknown>; form?: boolean };
  conversationId?: string;
  page?: string;
  subscription?: SubscriptionState;
}

/** One chat turn; returns every event, the last message shown, and the conversation id. */
export async function turn(opts: TurnOptions) {
  const events: AiEvent[] = [];
  await runTurn({
    module: opts.module ?? employeeModule,
    user: opts.user ?? admin,
    token: 'token',
    conversationId: opts.conversationId,
    message: opts.message,
    toolCall: opts.toolCall,
    page: opts.page,
    subscription: opts.subscription,
    emit: (e) => events.push(e),
    signal: new AbortController().signal,
    model: opts.model ?? scriptedModel(),
    api: opts.api,
  });
  const done = events.find((e) => e.type === 'done') as Extract<AiEvent, { type: 'done' }>;
  const messages = events.filter((e) => e.type === 'message').map((e) => (e as Extract<AiEvent, { type: 'message' }>).message);
  const last = messages[messages.length - 1] as ChatMessageView;
  return { events, last, conversationId: done.conversationId };
}


// ---- projects

export interface ProjectRow {
  id: string;
  name: string;
  description: string;
  deadline: string;
  status: ProjectStatus;
}

/** A project due on `day` (YYYY-MM-DD), stored the way the Projects page stores it. */
export function project(name: string, day: string, status: ProjectStatus = 'active', description = `${name} work`): ProjectRow {
  return { id: id(), name, description, deadline: deadlineInstant(day), status };
}

/** Enough of /projects and /tasks for the project tools, recording every call. */
export class FakeProjectApi implements ApiClient {
  calls: ApiCall[] = [];
  tasksByProject = new Map<string, number>();
  /** The user may not read tasks: /tasks answers 403. */
  tasksForbidden = false;
  constructor(public projects: ProjectRow[] = []) {}

  async get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return (await this.page<T>(path, query)).data;
  }

  async page<T>(path: string, query: Record<string, unknown> = {}) {
    this.calls.push({ method: 'GET', path, query });
    const ok = (data: unknown, total?: number) => ({ data: data as T, meta: { total } });
    if (path === '/projects') {
      const q = String(query.search ?? '').toLowerCase();
      const statuses = query.status ? String(query.status).split(',') : null;
      const matches = this.projects.filter((p) => {
        const day = deadlineDay(p.deadline);
        return (
          (!q || p.name.toLowerCase().includes(q)) &&
          (!statuses || statuses.includes(p.status)) &&
          (!query.dueFrom || day >= String(query.dueFrom)) &&
          (!query.dueTo || day <= String(query.dueTo))
        );
      });
      const limit = Number(query.limit ?? 10);
      const page = Number(query.page ?? 1);
      return ok(matches.slice((page - 1) * limit, page * limit), matches.length);
    }
    if (path === '/tasks') {
      if (this.tasksForbidden) throw new ApiCallError(403, "Missing 'read' permission on 'tasks'");
      return ok([], this.tasksByProject.get(String(query.projectId)) ?? 0);
    }
    const one = /^\/projects\/(\w+)$/.exec(path);
    if (one) return ok(this.find(one[1]));
    throw new Error(`Unexpected GET ${path}`);
  }

  async send<T>(call: ApiCall): Promise<T> {
    if (call.method === 'GET') return this.get<T>(call.path, call.query);
    this.calls.push(call);
    const body = (call.body ?? {}) as Partial<ProjectRow>;
    if (call.method === 'POST' && call.path === '/projects') {
      const created = { id: id(), name: body.name!, description: body.description!, deadline: body.deadline!, status: body.status ?? 'planning' };
      this.projects.push(created);
      return created as T;
    }
    const target = /^\/projects\/(\w+)$/.exec(call.path);
    if (target && call.method === 'PUT') return Object.assign(this.find(target[1]), body) as T;
    if (target && call.method === 'DELETE') {
      this.projects = this.projects.filter((p) => p.id !== target[1]);
      return { id: target[1], deleted: true } as T;
    }
    throw new Error(`Unexpected ${call.method} ${call.path}`);
  }

  private find(projectId: string): ProjectRow {
    const p = this.projects.find((x) => x.id === projectId);
    if (!p) throw new ApiCallError(404, 'Project not found');
    return p;
  }

  writes() {
    return this.calls.filter((c) => c.method !== 'GET');
  }
}

// ---- departments

export interface DepartmentRow {
  id: string;
  title: string;
  description: string;
  status: 'active' | 'inactive';
}

export function department(title: string, status: DepartmentRow['status'] = 'active', description = `${title} team`): DepartmentRow {
  return { id: id(), title, description, status };
}

/** Enough of /departments and /employees (counts only) for the department tools, recording every call. */
export class FakeDepartmentApi implements ApiClient {
  calls: ApiCall[] = [];
  employeesByDepartment = new Map<string, number>();
  /** The user may not read employees: /employees answers 403. */
  employeesForbidden = false;
  constructor(public departments: DepartmentRow[] = []) {}

  async get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return (await this.page<T>(path, query)).data;
  }

  async page<T>(path: string, query: Record<string, unknown> = {}) {
    this.calls.push({ method: 'GET', path, query });
    const ok = (data: unknown, total?: number) => ({ data: data as T, meta: { total } });
    if (path === '/departments') {
      const q = String(query.search ?? '').toLowerCase();
      const matches = this.departments
        .filter((d) => (!q || d.title.toLowerCase().includes(q) || d.description.toLowerCase().includes(q)) && (!query.status || d.status === query.status))
        .sort((a, b) => a.title.localeCompare(b.title));
      const limit = Number(query.limit ?? 10);
      const page = Number(query.page ?? 1);
      return ok(matches.slice((page - 1) * limit, page * limit), matches.length);
    }
    if (path === '/employees') {
      if (this.employeesForbidden) throw new ApiCallError(403, "Missing 'read' permission on 'employees'");
      return ok([], this.employeesByDepartment.get(String(query.department)) ?? 0);
    }
    const one = /^\/departments\/(\w+)$/.exec(path);
    if (one) return ok(this.find(one[1]));
    throw new Error(`Unexpected GET ${path}`);
  }

  async send<T>(call: ApiCall): Promise<T> {
    if (call.method === 'GET') return this.get<T>(call.path, call.query);
    this.calls.push(call);
    const body = (call.body ?? {}) as Partial<DepartmentRow>;
    if (call.method === 'POST' && call.path === '/departments') {
      const created = { id: id(), title: body.title!, description: body.description!, status: body.status ?? 'active' };
      this.departments.push(created);
      return created as T;
    }
    const target = /^\/departments\/(\w+)$/.exec(call.path);
    if (target && call.method === 'PUT') return Object.assign(this.find(target[1]), body) as T;
    if (target && call.method === 'DELETE') {
      if (this.employeesByDepartment.get(target[1])) throw new ApiCallError(400, 'Department is assigned to some employees');
      this.departments = this.departments.filter((d) => d.id !== target[1]);
      return { id: target[1], deleted: true } as T;
    }
    throw new Error(`Unexpected ${call.method} ${call.path}`);
  }

  private find(departmentId: string): DepartmentRow {
    const d = this.departments.find((x) => x.id === departmentId);
    if (!d) throw new ApiCallError(404, 'Department not found');
    return d;
  }

  writes() {
    return this.calls.filter((c) => c.method !== 'GET');
  }
}

// ---- exports

/** An ORG_USER role's matrix with read rights on these modules only. */
export const readRights = (...modules: string[]): EffectivePermissions =>
  ({ scope: 'matrix', entries: modules.map((module) => ({ module, read: true, create: false, update: false, delete: false })) }) as EffectivePermissions;

/** /auth/me for the export tool, recording every call. The browser does the downloads, so nothing else is called. */
export class FakeExportApi implements ApiClient {
  calls: ApiCall[] = [];
  constructor(
    public permissions: EffectivePermissions = { scope: 'all' },
    public planModules: string[] = [...PLAN_MODULES.professional]
  ) {}

  async get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return (await this.page<T>(path, query)).data;
  }

  async page<T>(path: string, query: Record<string, unknown> = {}) {
    this.calls.push({ method: 'GET', path, query });
    if (path === '/auth/me') return { data: { user: { permissions: this.permissions, subscription: { modules: this.planModules } } } as T, meta: {} };
    throw new Error(`Unexpected GET ${path}`);
  }

  async send<T>(call: ApiCall): Promise<T> {
    if (call.method === 'GET') return this.get<T>(call.path, call.query);
    throw new Error(`Unexpected ${call.method} ${call.path}`);
  }

  writes() {
    return this.calls.filter((c) => c.method !== 'GET');
  }
}

// ---- tasks

export interface TaskRow {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  description: string;
  dueDate: string;
  status: 'todo' | 'in-progress' | 'done' | 'blocked';
  userId: string[];
  userName: string;
}

export interface PersonRow {
  id: string;
  name: string;
  role: 'ORG_ADMIN' | 'ORG_USER';
}

export const P_APOLLO = id();
export const P_HERMES = id();
export const M_RAHUL = id();
export const M_MIKE_J = id();
export const M_MIKE_R = id();

/** Everyone in the fake organization. `employeeUser` is Priya Shah; `admin` is Nisarg, an ORG_ADMIN. */
export const PEOPLE: PersonRow[] = [
  { id: employeeUser.id, name: 'Priya Shah', role: 'ORG_USER' },
  { id: M_RAHUL, name: 'Rahul Verma', role: 'ORG_USER' },
  { id: M_MIKE_J, name: 'Mike Johnson', role: 'ORG_USER' },
  { id: M_MIKE_R, name: 'Mike Ross', role: 'ORG_USER' },
  { id: admin.id, name: 'Nisarg', role: 'ORG_ADMIN' },
];

/** Enough of /tasks, /projects and /people for the task tools, recording every call. */
export class FakeTaskApi implements ApiClient {
  calls: ApiCall[] = [];
  projects = [
    { id: P_APOLLO, name: 'Apollo' },
    { id: P_HERMES, name: 'Hermes' },
  ];
  people: PersonRow[] = [...PEOPLE];
  /** The user may not read projects: /projects answers 403. */
  projectsForbidden = false;
  tasks: TaskRow[] = [];

  /** A task the way GET /tasks shows it. */
  task(title: string, opts: Partial<Omit<TaskRow, 'userName' | 'projectName'>> = {}): TaskRow {
    const row = { id: id(), projectId: P_APOLLO, description: `${title} work`, dueDate: '2026-10-30', status: 'todo' as const, userId: [M_RAHUL], ...opts, title } as TaskRow;
    this.named(row);
    this.tasks.push(row);
    return row;
  }

  private named(row: TaskRow): TaskRow {
    row.projectName = this.projects.find((p) => p.id === row.projectId)?.name ?? 'Unknown';
    row.userName = row.userId.map((u) => this.people.find((p) => p.id === u)?.name ?? 'Unknown').join(',');
    return row;
  }

  async get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return (await this.page<T>(path, query)).data;
  }

  async page<T>(path: string, query: Record<string, unknown> = {}) {
    this.calls.push({ method: 'GET', path, query });
    const ok = (data: unknown, total?: number) => ({ data: data as T, meta: { total } });
    if (path === '/tasks') {
      const q = String(query.search ?? '').toLowerCase();
      const statuses = query.status ? String(query.status).split(',') : null;
      const matches = this.tasks.filter(
        (t) =>
          (!q || t.title.toLowerCase().includes(q)) &&
          (!query.projectId || t.projectId === query.projectId) &&
          (!statuses || statuses.includes(t.status)) &&
          (!query.dueFrom || t.dueDate >= String(query.dueFrom)) &&
          (!query.dueTo || t.dueDate <= String(query.dueTo)) &&
          (!query.memberId || t.userId.includes(String(query.memberId)))
      );
      const sorted = query.sortBy === 'dueDate' ? [...matches].sort((a, b) => a.dueDate.localeCompare(b.dueDate)) : matches;
      const limit = Number(query.limit ?? 10);
      const page = Number(query.page ?? 1);
      return ok(sorted.slice((page - 1) * limit, page * limit), matches.length);
    }
    if (path === '/projects') {
      if (this.projectsForbidden) throw new ApiCallError(403, "Missing 'read' permission on 'projects'");
      return ok(this.projects, this.projects.length);
    }
    if (path === '/people/search') return ok(this.people.filter((p) => p.name.toLowerCase().includes(String(query.q).toLowerCase())));
    const person = /^\/people\/(\w+)$/.exec(path);
    if (person) {
      const p = this.people.find((x) => x.id === person[1]);
      if (!p) throw new ApiCallError(404, 'Person not found');
      return ok(p);
    }
    const one = /^\/tasks\/(\w+)$/.exec(path);
    if (one) return ok({ ...this.find(one[1]), userName: this.find(one[1]).userName.split(',').join(', ') });
    throw new Error(`Unexpected GET ${path}`);
  }

  async send<T>(call: ApiCall): Promise<T> {
    if (call.method === 'GET') return this.get<T>(call.path, call.query);
    this.calls.push(call);
    const body = (call.body ?? {}) as Partial<TaskRow>;
    if (call.method === 'POST' && call.path === '/tasks') {
      const created = this.named({ id: id(), status: 'todo', ...body } as TaskRow);
      this.tasks.push(created);
      return created as T;
    }
    const target = /^\/tasks\/(\w+)$/.exec(call.path);
    if (target && call.method === 'PUT') return this.named(Object.assign(this.find(target[1]), body)) as T;
    if (target && call.method === 'DELETE') {
      this.tasks = this.tasks.filter((t) => t.id !== target[1]);
      return { id: target[1], deleted: true } as T;
    }
    throw new Error(`Unexpected ${call.method} ${call.path}`);
  }

  private find(taskId: string): TaskRow {
    const t = this.tasks.find((x) => x.id === taskId);
    if (!t) throw new ApiCallError(404, 'Task not found');
    return t;
  }

  writes() {
    return this.calls.filter((c) => c.method !== 'GET');
  }
}

// ---- documents

export interface DocumentRow {
  id: string;
  title: string;
  description: string;
  category: string;
  status: 'active' | 'archived';
  file: { id: string; originalName: string; mimeType: string; size: number } | null;
}

export function documentRow(title: string, category = 'HR', opts: Partial<DocumentRow> = {}): DocumentRow {
  return { id: id(), title, description: `${title} details`, category, status: 'active', file: { id: id(), originalName: `${title.toLowerCase().replace(/\s+/g, '-')}.pdf`, mimeType: 'application/pdf', size: 1258291 }, ...opts };
}

/** A small PDF as the upload middleware hands it over. */
export const pdf = (name = 'handbook.pdf'): UploadedFile => ({ buffer: Buffer.from('%PDF-1.4 test'), originalname: name, mimetype: 'application/pdf', size: 1258291 });

/** Enough of /documents for the document tools, recording every call and the file sent with it. */
export class FakeDocumentApi implements ApiClient {
  calls: (ApiCall & { file?: string })[] = [];
  constructor(public documents: DocumentRow[] = []) {}

  async get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return (await this.page<T>(path, query)).data;
  }

  async page<T>(path: string, query: Record<string, unknown> = {}) {
    this.calls.push({ method: 'GET', path, query });
    const ok = (data: unknown, total?: number) => ({ data: data as T, meta: { total } });
    if (path === '/documents') {
      const q = String(query.search ?? '').toLowerCase();
      const matches = this.documents
        .filter(
          (d) =>
            (!q || d.title.toLowerCase().includes(q) || d.category.toLowerCase().includes(q)) &&
            (!query.category || d.category.toLowerCase() === String(query.category).toLowerCase()) &&
            (!query.status || d.status === query.status)
        )
        .sort((a, b) => a.title.localeCompare(b.title));
      const limit = Number(query.limit ?? 10);
      const page = Number(query.page ?? 1);
      return ok(matches.slice((page - 1) * limit, page * limit), matches.length);
    }
    const one = /^\/documents\/(\w+)$/.exec(path);
    if (one) return ok(this.find(one[1]));
    throw new Error(`Unexpected GET ${path}`);
  }

  async send<T>(call: ApiCall, file?: UploadedFile): Promise<T> {
    if (call.method === 'GET') return this.get<T>(call.path, call.query);
    this.calls.push({ ...call, ...(file ? { file: file.originalname } : {}) });
    const body = (call.body ?? {}) as Partial<DocumentRow>;
    const attached = file ? { id: id(), originalName: file.originalname, mimeType: file.mimetype, size: file.size } : null;
    if (call.method === 'POST' && call.path === '/documents') {
      const created: DocumentRow = { id: id(), title: body.title!, description: body.description!, category: body.category!, status: body.status ?? 'active', file: attached };
      this.documents.push(created);
      return created as T;
    }
    const target = /^\/documents\/(\w+)$/.exec(call.path);
    if (target && call.method === 'PUT') return Object.assign(this.find(target[1]), body, attached ? { file: attached } : {}) as T;
    if (target && call.method === 'DELETE') {
      this.documents = this.documents.filter((d) => d.id !== target[1]);
      return { id: target[1], deleted: true } as T;
    }
    throw new Error(`Unexpected ${call.method} ${call.path}`);
  }

  private find(documentId: string): DocumentRow {
    const d = this.documents.find((x) => x.id === documentId);
    if (!d) throw new ApiCallError(404, 'Document not found');
    return d;
  }

  writes() {
    return this.calls.filter((c) => c.method !== 'GET');
  }
}

// ---- roles

export interface RoleRow {
  id: string;
  name: string;
  permissions: { module: string; read: boolean; create: boolean; update: boolean; delete: boolean }[];
}

const FLAGS = { R: 'read', C: 'create', U: 'update', D: 'delete' } as const;

/** role('HR Manager', { employees: 'RCU', documents: 'RCUD' }) */
export function role(name: string, rights: Record<string, string> = {}): RoleRow {
  return {
    id: id(),
    name,
    permissions: Object.entries(rights).map(([module, letters]) => ({
      module,
      ...(Object.fromEntries(Object.entries(FLAGS).map(([letter, action]) => [action, letters.includes(letter)])) as Record<'read' | 'create' | 'update' | 'delete', boolean>),
    })),
  };
}

/** /roles, /auth/me (the plan's modules) and /employees?roleId= counts. */
export class FakeRoleApi implements ApiClient {
  calls: ApiCall[] = [];
  /** Employees per role id. */
  holders = new Map<string, number>();
  constructor(
    public roles: RoleRow[] = [],
    public planModules: string[] = [...PLAN_MODULES.professional]
  ) {}

  async get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return (await this.page<T>(path, query)).data;
  }

  async page<T>(path: string, query: Record<string, unknown> = {}) {
    this.calls.push({ method: 'GET', path, query });
    const ok = (data: unknown, total?: number) => ({ data: data as T, meta: { total } });
    if (path === '/auth/me') return ok({ user: { subscription: { modules: this.planModules } } });
    if (path === '/employees') return ok([], this.holders.get(String(query.roleId)) ?? 0);
    if (path === '/roles') {
      const q = String(query.search ?? '').toLowerCase();
      const matches = this.roles.filter((r) => !q || r.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
      const limit = Number(query.limit ?? 10);
      const page = Number(query.page ?? 1);
      return ok(matches.slice((page - 1) * limit, page * limit), matches.length);
    }
    const one = /^\/roles\/(\w+)$/.exec(path);
    if (one) return ok(this.find(one[1]));
    throw new Error(`Unexpected GET ${path}`);
  }

  async send<T>(call: ApiCall): Promise<T> {
    if (call.method === 'GET') return this.get<T>(call.path, call.query);
    this.calls.push(call);
    const body = (call.body ?? {}) as Partial<RoleRow>;
    if (call.method === 'POST' && call.path === '/roles') {
      const created: RoleRow = { id: id(), name: body.name!, permissions: body.permissions ?? [] };
      this.roles.push(created);
      return created as T;
    }
    const target = /^\/roles\/(\w+)$/.exec(call.path);
    if (target && call.method === 'PUT') return Object.assign(this.find(target[1]), body) as T;
    if (target && call.method === 'DELETE') {
      if (this.holders.get(target[1])) throw new ApiCallError(400, 'Role is assigned to some users');
      this.roles = this.roles.filter((r) => r.id !== target[1]);
      return { id: target[1], deleted: true } as T;
    }
    throw new Error(`Unexpected ${call.method} ${call.path}`);
  }

  private find(roleId: string): RoleRow {
    const r = this.roles.find((x) => x.id === roleId);
    if (!r) throw new ApiCallError(404, 'Role not found');
    return r;
  }

  writes() {
    return this.calls.filter((c) => c.method !== 'GET');
  }
}

// ---- expenses

export interface ClaimRow {
  id: string;
  number: string;
  title: string;
  status: 'submitted' | 'approved' | 'rejected' | 'paid';
  totalPaise: number;
  itemCount: number;
  overLimitCount: number;
  employeeId: string;
  employeeName: string | null;
  submittedAt: string | null;
  /** Not in the API's answer: what the fake filters on. */
  categoryIds: string[];
  dates: string[];
}

export interface CategoryRow {
  id: string;
  name: string;
  limitPaise: number | null;
  receiptRequiredAbovePaise: number;
  isActive: boolean;
}

export function category(name: string, limitPaise: number | null = null, receiptRequiredAbovePaise = 50000, isActive = true): CategoryRow {
  return { id: id(), name, limitPaise, receiptRequiredAbovePaise, isActive };
}

export const E_RAHUL = id();
export const E_PRIYA = id();
export const E_RAHUL_V = id();
export const EXPENSE_PEOPLE = [
  { id: E_RAHUL, name: 'Rahul Sharma', jobTitle: 'Engineer', departmentName: 'Engineering' },
  { id: E_PRIYA, name: 'Priya Shah', jobTitle: 'Designer', departmentName: 'Design' },
  { id: E_RAHUL_V, name: 'Rahul Verma', jobTitle: 'Sales lead', departmentName: 'Sales' },
];

/** /expenses (with its filters), /expenses/summary, /expense-categories, /people and /auth/me. */
export class FakeExpenseApi implements ApiClient {
  calls: ApiCall[] = [];
  claims: ClaimRow[] = [];
  summary = {
    approvedPaise: 8450000,
    paidPaise: 6000000,
    byCategory: [
      { categoryId: 'c1', name: 'Travel', totalPaise: 5000000, count: 12 },
      { categoryId: 'c2', name: 'Food & meals', totalPaise: 3450000, count: 30 },
    ],
    byDepartment: [{ departmentId: 'd1', name: 'Engineering', totalPaise: 8450000, count: 42 }],
    awaitingApproval: { count: 3, totalPaise: 1240000 },
    awaitingPayment: { count: 2, totalPaise: 980000 },
  };
  planModules: string[] = [...PLAN_MODULES.professional];
  constructor(public categories: CategoryRow[] = []) {}

  claim(title: string, status: ClaimRow['status'], employeeId: string, categoryIds: string[], dates: string[], totalPaise = 250000): ClaimRow {
    const person = EXPENSE_PEOPLE.find((p) => p.id === employeeId);
    const c: ClaimRow = {
      id: id(),
      number: `EXP-${String(this.claims.length + 1).padStart(4, '0')}`,
      title,
      status,
      totalPaise,
      itemCount: dates.length,
      overLimitCount: 0,
      employeeId,
      employeeName: person?.name ?? null,
      submittedAt: `${dates[dates.length - 1]}T10:00:00.000Z`,
      categoryIds,
      dates,
    };
    this.claims.push(c);
    return c;
  }

  async get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return (await this.page<T>(path, query)).data;
  }

  async page<T>(path: string, query: Record<string, unknown> = {}) {
    this.calls.push({ method: 'GET', path, query });
    const ok = (data: unknown, total?: number) => ({ data: data as T, meta: { total } });
    if (path === '/auth/me') return ok({ user: { subscription: { modules: this.planModules } } });
    if (path === '/people') return ok(EXPENSE_PEOPLE);
    if (path === '/expense-categories') return ok([...this.categories].sort((a, b) => a.name.localeCompare(b.name)));
    if (path === '/expenses/summary') return ok({ from: query.from, to: query.to, ...this.summary });
    if (path === '/expenses') {
      const matches = this.claims.filter(
        (c) =>
          (!query.status || c.status === query.status) &&
          (!query.employeeId || c.employeeId === query.employeeId) &&
          (!query.categoryId || c.categoryIds.includes(String(query.categoryId))) &&
          (!query.from || c.dates.some((d) => d >= String(query.from))) &&
          (!query.to || c.dates.some((d) => d <= String(query.to)))
      );
      const limit = Number(query.limit ?? 20);
      const page = Number(query.page ?? 1);
      // The API's answer leaves out what the fake filters on.
      const rows = matches.slice((page - 1) * limit, page * limit).map(({ categoryIds: _c, dates: _d, ...rest }) => rest);
      return ok(rows, matches.length);
    }
    throw new Error(`Unexpected GET ${path}`);
  }

  async send<T>(call: ApiCall): Promise<T> {
    if (call.method === 'GET') return this.get<T>(call.path, call.query);
    this.calls.push(call);
    const body = (call.body ?? {}) as Partial<CategoryRow>;
    if (call.method === 'POST' && call.path === '/expense-categories') {
      const created: CategoryRow = { id: id(), name: body.name!, limitPaise: body.limitPaise ?? null, receiptRequiredAbovePaise: body.receiptRequiredAbovePaise ?? 50000, isActive: body.isActive ?? true };
      this.categories.push(created);
      return created as T;
    }
    const target = /^\/expense-categories\/(\w+)$/.exec(call.path);
    if (target && call.method === 'PUT') return Object.assign(this.find(target[1]), body) as T;
    if (target && call.method === 'DELETE') {
      this.categories = this.categories.filter((c) => c.id !== target[1]);
      return { id: target[1], deleted: true } as T;
    }
    throw new Error(`Unexpected ${call.method} ${call.path}`);
  }

  private find(categoryId: string): CategoryRow {
    const c = this.categories.find((x) => x.id === categoryId);
    if (!c) throw new ApiCallError(404, 'Category not found');
    return c;
  }

  writes() {
    return this.calls.filter((c) => c.method !== 'GET');
  }

  /** The last GET of a path: what the tool asked the API for. */
  lastQuery(path: string) {
    return [...this.calls].reverse().find((c) => c.method === 'GET' && c.path === path)?.query;
  }
}

// ---- the Me page: leave, attendance and my expenses

const fieldError = (field: string, message: string) => new ApiCallError(400, message, { fieldErrors: { [field]: [message] } });
const weekdays = (from: string, to: string) => {
  let n = 0;
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) if (![0, 6].includes(d.getUTCDay())) n += 1;
  return n;
};

export interface LeaveTypeRow {
  leaveTypeId: string;
  name: string;
  code: string;
  isPaid: boolean;
  allowHalfDay: boolean;
  yearlyQuota: number | null;
  approved: number;
  pending: number;
  available: number | null;
}

export const PAID = id();
export const UNPAID = id();

export function leaveTypes(paidLeft = 9): LeaveTypeRow[] {
  return [
    { leaveTypeId: PAID, name: 'Paid Leave', code: 'PL', isPaid: true, allowHalfDay: true, yearlyQuota: 12, approved: 12 - paidLeft, pending: 0, available: paidLeft },
    { leaveTypeId: UNPAID, name: 'Unpaid Leave', code: 'UL', isPaid: false, allowHalfDay: true, yearlyQuota: null, approved: 0, pending: 0, available: null },
  ];
}

export interface MyLeaveRow {
  id: string;
  leaveTypeId: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  halfDay: 'first' | 'second' | null;
  days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  canCancel: boolean;
}

export interface MyAttendanceRequest {
  id: string;
  kind: 'regularization' | 'wfh';
  startDate: string;
  endDate: string;
  clockIn: string | null;
  clockOut: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  canCancel: boolean;
}

/** /leave/* and /attendance/* for the signed-in user, with the API's own checks. `today` is real: tests use dates relative to it. */
export class FakeMeApi implements ApiClient {
  calls: ApiCall[] = [];
  leave: MyLeaveRow[] = [];
  requests: MyAttendanceRequest[] = [];
  constructor(public types: LeaveTypeRow[] = leaveTypes(), public today: string) {}

  async get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return (await this.page<T>(path, query)).data;
  }

  async page<T>(path: string, query: Record<string, unknown> = {}) {
    this.calls.push({ method: 'GET', path, query });
    const ok = (data: unknown) => ({ data: data as T, meta: {} });
    if (path === '/leave/balances') return ok(this.types);
    if (path === '/leave/requests/mine') return ok(this.leave);
    if (path === '/leave/preview') return ok(this.check(query as never));
    if (path === '/attendance/requests/mine') return ok(this.requests);
    if (path === '/attendance/me') {
      return ok({
        month: query.month,
        days: [{ date: `${query.month}-05`, missingClockOut: true, status: 'present' }],
        totals: { present: 14, halfDay: 1, absent: 0, late: 2, onLeave: 1, averageMinutes: 520 },
      });
    }
    throw new Error(`Unexpected GET ${path}`);
  }

  /** leave.service checkRequest, in short. */
  private check(q: { leaveTypeId: string; startDate: string; endDate: string; halfDay?: string }) {
    const type = this.types.find((t) => t.leaveTypeId === q.leaveTypeId);
    if (!type) throw fieldError('leaveTypeId', 'Choose a valid leave type');
    if (q.startDate < this.today) throw fieldError('startDate', "Leave can't start before today. For an emergency, ask your admin to record it for you.");
    const days = q.halfDay ? (weekdays(q.startDate, q.startDate) ? 0.5 : 0) : weekdays(q.startDate, q.endDate);
    if (!days) throw fieldError('startDate', 'The selected dates are all weekends or holidays');
    if (type.available !== null && days > type.available) throw fieldError('leaveTypeId', `Only ${Math.max(type.available, 0)} day(s) of ${type.name} left this year`);
    return { days, availableAfter: type.available === null ? null : type.available - days };
  }

  async send<T>(call: ApiCall): Promise<T> {
    if (call.method === 'GET') return this.get<T>(call.path, call.query);
    this.calls.push(call);
    const body = (call.body ?? {}) as Record<string, string>;
    if (call.path === '/leave/requests') {
      const { days } = this.check(body as never);
      const type = this.types.find((t) => t.leaveTypeId === body.leaveTypeId)!;
      const row: MyLeaveRow = { id: id(), leaveTypeId: type.leaveTypeId, leaveTypeName: type.name, startDate: body.startDate, endDate: body.endDate, halfDay: (body.halfDay as MyLeaveRow['halfDay']) ?? null, days, reason: body.reason, status: 'pending', canCancel: true };
      this.leave.unshift(row);
      return row as T;
    }
    const leaveCancel = /^\/leave\/requests\/(\w+)\/cancel$/.exec(call.path);
    if (leaveCancel) return Object.assign(this.leave.find((r) => r.id === leaveCancel[1])!, { status: 'cancelled', canCancel: false }) as T;
    if (call.path === '/attendance/requests') {
      const row: MyAttendanceRequest =
        body.kind === 'wfh'
          ? { id: id(), kind: 'wfh', startDate: body.startDate, endDate: body.endDate, clockIn: null, clockOut: null, reason: body.reason, status: 'pending', canCancel: true }
          : { id: id(), kind: 'regularization', startDate: body.date, endDate: body.date, clockIn: body.clockIn, clockOut: body.clockOut, reason: body.reason, status: 'pending', canCancel: true };
      this.requests.unshift(row);
      return row as T;
    }
    const attendanceCancel = /^\/attendance\/requests\/(\w+)\/cancel$/.exec(call.path);
    if (attendanceCancel) return Object.assign(this.requests.find((r) => r.id === attendanceCancel[1])!, { status: 'cancelled', canCancel: false }) as T;
    throw new Error(`Unexpected ${call.method} ${call.path}`);
  }

  writes() {
    return this.calls.filter((c) => c.method !== 'GET');
  }
}

export interface MyClaimItem {
  id: string;
  date: string;
  categoryId: string;
  categoryName: string;
  amountPaise: number;
  merchant: string;
  note: string;
  receipts: { id: string; originalName: string }[];
  missingReceipt: boolean;
}

export interface MyClaimRow {
  id: string;
  number: string | null;
  title: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid';
  totalPaise: number;
  itemCount: number;
  items: MyClaimItem[];
}

/** The employee's /expenses endpoints and the active /expense-categories, with the submit checks. */
export class FakeMyExpenseApi implements ApiClient {
  calls: (ApiCall & { file?: string })[] = [];
  claims: MyClaimRow[] = [];
  /** Make this path fail once (a submit refused after the claim was made). */
  failOn?: { path: RegExp; message: string };
  constructor(public categories: CategoryRow[] = []) {}

  claim(title: string, items: Omit<MyClaimItem, 'id' | 'categoryName' | 'missingReceipt' | 'receipts'>[] = []): MyClaimRow {
    const c: MyClaimRow = { id: id(), number: null, title, status: 'draft', totalPaise: 0, itemCount: 0, items: [] };
    this.claims.push(c);
    for (const i of items) this.addItem(c, i);
    return c;
  }

  private addItem(c: MyClaimRow, i: { date: string; categoryId: string; amountPaise: number; merchant: string; note: string }) {
    const category = this.categories.find((x) => x.id === i.categoryId)!;
    // Ids grow with time, as ObjectIds do.
    c.items.push({ ...i, id: `${'f'.repeat(16)}${String(c.items.length + 1).padStart(8, '0')}`, categoryName: category.name, receipts: [], missingReceipt: i.amountPaise > category.receiptRequiredAbovePaise });
    c.items.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    c.totalPaise = c.items.reduce((t, x) => t + x.amountPaise, 0);
    c.itemCount = c.items.length;
  }

  async get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return (await this.page<T>(path, query)).data;
  }

  async page<T>(path: string, query: Record<string, unknown> = {}) {
    this.calls.push({ method: 'GET', path, query });
    const ok = (data: unknown) => ({ data: data as T, meta: {} });
    if (path === '/expense-categories') return ok(this.categories.filter((c) => c.isActive));
    if (path === '/expenses/mine') return ok(this.claims.filter((c) => !query.status || c.status === query.status).map(({ items: _i, ...rest }) => rest));
    const one = /^\/expenses\/(\w+)$/.exec(path);
    if (one) return ok(this.find(one[1]));
    throw new Error(`Unexpected GET ${path}`);
  }

  async send<T>(call: ApiCall, file?: UploadedFile): Promise<T> {
    if (call.method === 'GET') return this.get<T>(call.path, call.query);
    this.calls.push({ ...call, ...(file ? { file: file.originalname } : {}) });
    if (this.failOn?.path.test(call.path)) {
      const { message } = this.failOn;
      this.failOn = undefined;
      throw new ApiCallError(400, message);
    }
    const body = (call.body ?? {}) as Record<string, unknown>;
    if (call.path === '/expenses') return this.claim(String(body.title)) as T;
    const items = /^\/expenses\/(\w+)\/items$/.exec(call.path);
    if (items) {
      const c = this.find(items[1]);
      this.addItem(c, body as never);
      return c as T;
    }
    const receipt = /^\/expenses\/(\w+)\/items\/(\w+)\/receipts$/.exec(call.path);
    if (receipt) {
      if (!file) throw new ApiCallError(400, 'Attach a receipt file');
      const c = this.find(receipt[1]);
      const item = c.items.find((i) => i.id === receipt[2]);
      if (!item) throw new ApiCallError(404, 'Expense not found');
      item.receipts.push({ id: id(), originalName: file.originalname });
      item.missingReceipt = false;
      return c as T;
    }
    const submit = /^\/expenses\/(\w+)\/submit$/.exec(call.path);
    if (submit) {
      const c = this.find(submit[1]);
      const missing = c.items.find((i) => i.missingReceipt);
      if (missing) throw new ApiCallError(400, `${missing.merchant} (${missing.date}) needs a receipt`);
      return Object.assign(c, { status: 'submitted', number: 'EXP-2026-0012' }) as T;
    }
    throw new Error(`Unexpected ${call.method} ${call.path}`);
  }

  private find(claimId: string): MyClaimRow {
    const c = this.claims.find((x) => x.id === claimId);
    if (!c) throw new ApiCallError(404, 'Claim not found');
    return c;
  }

  writes() {
    return this.calls.filter((c) => c.method !== 'GET');
  }
}

// ---- audit logs

export interface AuditRowFake {
  id: string;
  actorName: string;
  actorRole: 'SUPER_ADMIN' | 'ORG_ADMIN' | 'ORG_USER';
  action: 'create' | 'update' | 'delete' | 'login' | 'logout';
  module: string | null;
  recordLabel: string | null;
  createdAt: string;
}

export function auditRow(action: AuditRowFake['action'], module: string | null, createdAt: string, recordLabel: string | null = null, actorName = 'Nisarg'): AuditRowFake {
  return { id: id(), actorName, actorRole: 'ORG_ADMIN', action, module, recordLabel, createdAt };
}

/** GET /audit-logs with its filters, newest first. */
export class FakeAuditApi implements ApiClient {
  calls: ApiCall[] = [];
  constructor(public rows: AuditRowFake[] = []) {}

  async get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return (await this.page<T>(path, query)).data;
  }

  async page<T>(path: string, query: Record<string, unknown> = {}) {
    this.calls.push({ method: 'GET', path, query });
    if (path !== '/audit-logs') throw new Error(`Unexpected GET ${path}`);
    const matches = this.rows
      .filter(
        (r) =>
          (!query.module || r.module === query.module) &&
          (!query.action || r.action === query.action) &&
          (!query.from || r.createdAt >= String(query.from)) &&
          (!query.to || r.createdAt <= String(query.to))
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const limit = Number(query.limit ?? 20);
    const page = Number(query.page ?? 1);
    return { data: matches.slice((page - 1) * limit, page * limit) as T, meta: { total: matches.length } };
  }

  async send<T>(call: ApiCall): Promise<T> {
    if (call.method === 'GET') return this.get<T>(call.path, call.query);
    throw new Error(`The audit log is read-only: ${call.method} ${call.path}`);
  }

  lastQuery() {
    return [...this.calls].reverse().find((c) => c.path === '/audit-logs')?.query;
  }
}
