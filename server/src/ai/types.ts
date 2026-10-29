import { z } from 'zod';
import { ModuleName, PlanFeature } from '../constants/modules';
import { PermissionAction } from '../permissions/checkPermission';
import { SubscriptionState } from '../services/subscription.service';
import { AuthenticatedUser } from '../types/express';

/** One call to the existing REST API, relative to /api/v1. */
export interface ApiCall {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /**
   * May use what an earlier call of the same Confirm returned: `{0.id}` is the first result's id,
   * `{1.items.-1.id}` the id of the second result's last item (a new claim, then its expense).
   */
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  /** Send the body's fields with the file the user chose on the card, as multipart/form-data (documents). */
  attachFile?: boolean;
  /** Skip this call when no file was chosen (an optional receipt). */
  skipWithoutFile?: boolean;
}

/** A file the user chose on a confirm card: held in memory for the length of the confirm request, never stored. */
export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface ApiPage<T> {
  data: T;
  meta: { page?: number; limit?: number; total?: number };
}

/** Internal HTTP calls made with the signed-in user's own token (see apiClient.ts). */
export interface ApiClient {
  get<T>(path: string, query?: Record<string, unknown>): Promise<T>;
  page<T>(path: string, query?: Record<string, unknown>): Promise<ApiPage<T>>;
  /** `file` goes with a call marked `attachFile`. */
  send<T>(call: ApiCall, file?: UploadedFile): Promise<T>;
}

/** Sends a tool call straight to the server, with no model call (starter chips, row buttons). */
export interface ToolCallRef {
  name: string;
  args: Record<string, unknown>;
  /** Opens the tool's form card instead of asking questions. */
  form?: boolean;
}

export interface AiButton {
  label: string;
  toolCall: ToolCallRef;
}

export interface AiTable {
  columns: { key: string; title: string }[];
  rows: Record<string, string>[];
}

/** A file the browser downloads from the existing API with the user's own token (an export's CSV). */
export interface AiDownload {
  /** "Employees CSV". */
  label: string;
  /** Relative to /api/v1, e.g. "/exports/employees". */
  path: string;
}

/** What the chat shows for an answer. `text` supports **bold** only. */
export interface AiResult {
  text: string;
  table?: AiTable;
  buttons?: AiButton[];
  warnings?: string[];
  /** Files for the browser to download; each also gets a button to download it again. */
  downloads?: AiDownload[];
  /** Start the downloads as soon as the answer arrives (never for an answer loaded from history). */
  autoDownload?: boolean;
  /**
   * The page behind the drawer follows the answer: a path on that page with its filters
   * ("/expenses?tab=summary&from=2026-10-01&to=2026-10-21"). Only for a live answer.
   */
  view?: string;
  /**
   * Open this page of the app, after the answer has arrived (docs/AI_NAVIGATION_ASSISTANT.md).
   * Only ever a path from the navigation page list that the user may open. Only for a live answer.
   */
  goTo?: string;
}

/** Values of the editable employee form on a confirm card. Ids, not names. */
export interface EmployeeFormValues {
  name: string;
  email: string;
  jobTitle: string;
  department: string;
  roleId: string;
  status?: 'active' | 'disabled';
  /** '' = no manager. */
  reportsTo: string;
  /** YYYY-MM-DD or ''. */
  joiningDate: string;
  /** YYYY-MM-DD or ''. */
  dateOfBirth: string;
}

/** Values of the editable project form. `deadline` is a YYYY-MM-DD day or ''. */
export interface ProjectFormValues {
  name: string;
  description: string;
  deadline: string;
  status: 'planning' | 'active' | 'completed' | 'on-hold';
}

/** Values of the editable department form. */
export interface DepartmentFormValues {
  title: string;
  description: string;
  status: 'active' | 'inactive';
}

/** Values of the editable task form. Ids, not names; `dueDate` is a YYYY-MM-DD day or ''. */
export interface TaskFormValues {
  title: string;
  description: string;
  dueDate: string;
  status: 'todo' | 'in-progress' | 'done' | 'blocked';
  /** '' = not chosen yet. */
  projectId: string;
  /** The members. */
  userId: string[];
}

/** Values of the editable document form. The file is chosen separately, on the card. */
export interface DocumentFormValues {
  title: string;
  description: string;
  category: string;
  status: 'active' | 'archived';
}

/** Values of the editable role form: the name, and one entry per module that has Read. */
export interface RoleFormValues {
  name: string;
  permissions: { module: ModuleName; read: boolean; create: boolean; update: boolean; delete: boolean }[];
}

/** Values of the editable expense category form, in rupees as on the page. */
export interface CategoryFormValues {
  name: string;
  /** null = no limit. */
  limitRupees: number | null;
  /** 0 = a receipt is always needed. */
  receiptAboveRupees: number;
  isActive: boolean;
}

/** Values of the editable leave form. Dates are YYYY-MM-DD; a half day is one date. */
export interface LeaveFormValues {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  halfDay: 'first' | 'second' | null;
  reason: string;
}

export interface LeaveTypeOption {
  id: string;
  name: string;
  isPaid: boolean;
  allowHalfDay: boolean;
  /** null = unlimited. */
  available: number | null;
}

export interface WfhFormValues {
  startDate: string;
  endDate: string;
  reason: string;
}

/** Times are HH:mm, 24-hour. */
export interface FixFormValues {
  date: string;
  clockIn: string;
  clockOut: string;
  reason: string;
}

/**
 * Values of the editable claim form: the claim's title (only for a new claim), one expense, and
 * whether to submit it now. The receipt is chosen separately, on the card.
 */
export interface ClaimFormValues {
  title: string;
  date: string;
  categoryId: string;
  amountRupees: number | null;
  merchant: string;
  note: string;
  submitNow: boolean;
}

export interface ClaimCategoryOption {
  id: string;
  name: string;
  /** null = no limit. */
  limitPaise: number | null;
  /** 0 = a receipt is always needed. */
  receiptRequiredAbovePaise: number;
}

/** Values of the editable goal form, as in the New goal dialog. Dates are YYYY-MM-DD; `ownerId` '' = mine. */
export interface GoalFormValues {
  ownerId: string;
  title: string;
  description: string;
  startDate: string;
  dueDate: string;
  /** null = none. */
  weight: number | null;
}

export type GoalStatus = 'on_track' | 'at_risk' | 'behind' | 'completed' | 'cancelled';

/** Values of the editable check-in form, as in the goal drawer. */
export interface CheckInFormValues {
  progress: number;
  status: GoalStatus;
  comment: string;
}

/** Values of the editable review form: an answer per question id, the 1–5 rating, and whether to submit. */
export interface ReviewFormValues {
  answers: Record<string, string>;
  rating: number | null;
  submitNow: boolean;
}

/** '' = no date of birth (removes it). */
export interface BirthdayFormValues {
  dateOfBirth: string;
}

export interface IntroductionFormValues {
  about: string;
  hobbies: string;
  lovesAboutJob: string;
}

export type CardForm =
  | { kind: 'employee'; mode: 'create' | 'update'; values: EmployeeFormValues }
  | { kind: 'role'; mode: 'create' | 'update'; values: RoleFormValues }
  | { kind: 'category'; mode: 'create' | 'update'; values: CategoryFormValues }
  /** `types`: the user's leave types with their balances, for the form's type list. */
  | { kind: 'leave'; mode: 'create'; values: LeaveFormValues; types: LeaveTypeOption[] }
  | { kind: 'wfh'; mode: 'create'; values: WfhFormValues }
  | { kind: 'fix'; mode: 'create'; values: FixFormValues }
  /** `categories`: the active ones with their rules, so the form knows when a receipt is needed. */
  | { kind: 'claim'; mode: 'create' | 'update'; values: ClaimFormValues; categories: ClaimCategoryOption[] }
  /** `owners`: whose a new goal can be (the user's direct reports, or anyone for an admin); empty = the user's own. */
  | { kind: 'goal'; mode: 'create' | 'update'; values: GoalFormValues; owners: { id: string; name: string }[] }
  | { kind: 'checkin'; mode: 'update'; values: CheckInFormValues }
  /** `questions`: the cycle's, in order. */
  | { kind: 'review'; mode: 'update'; values: ReviewFormValues; questions: { id: string; text: string }[] }
  | { kind: 'birthday'; mode: 'update'; values: BirthdayFormValues }
  | { kind: 'introduction'; mode: 'update'; values: IntroductionFormValues }
  /** `categories`: the ones in use, for the form to suggest. */
  | { kind: 'document'; mode: 'create' | 'update'; values: DocumentFormValues; categories: string[] }
  | { kind: 'project'; mode: 'create' | 'update'; values: ProjectFormValues }
  | { kind: 'department'; mode: 'create' | 'update'; values: DepartmentFormValues }
  /** `labels`: id → name for the project and members on the card, in case the form's lists lack them. */
  | { kind: 'task'; mode: 'create' | 'update'; values: TaskFormValues; labels: Record<string, string> };

export interface ConfirmCard {
  title: string;
  /** 'danger' draws a red card (deletes). */
  tone: 'default' | 'danger';
  /** What will happen, in plain words. `previous` shows "old → new" on updates. */
  rows: { label: string; value: string; previous?: string }[];
  warnings?: string[];
  notes?: string[];
  confirmLabel: string;
  /** An editable form; Confirm sends its values back. */
  form?: CardForm;
  /** True when the form must be completed before Confirm (some required values are missing). */
  incomplete?: boolean;
  /**
   * A file field on the card: chosen in the browser and sent with the Confirm click. `current`: the
   * file there now. `kind`: what the endpoint takes (documents: PDF, Word, JPG, PNG; receipts: PDF, JPG, PNG).
   */
  file?: { required: boolean; current?: string; kind?: 'document' | 'receipt' };
}

/** Saved on the conversation while a write tool waits for more details. */
export interface ToolDraft {
  tool: string;
  args: Record<string, unknown>;
  missing: string[];
  notSaved: string[];
  /**
   * The next reply is free text taken as it is (a review answer): it skips the small-talk and
   * other-tab checks, so "Great teamwork this quarter" is an answer, not a thank-you.
   */
  freeText?: boolean;
}

export type Prepared =
  | { kind: 'card'; card: ConfirmCard; calls: ApiCall[]; meta?: Record<string, unknown> }
  | { kind: 'ask'; result: AiResult; draft?: ToolDraft | null }
  /**
   * The model picked the wrong tool ("Mark the login bug as done" as a delete): run this one
   * instead, so the card belongs to the tool that will really run. Followed once per turn.
   */
  | { kind: 'reroute'; tool: string; args: Record<string, unknown> };

export interface ToolContext {
  user: AuthenticatedUser;
  /** YYYY-MM-DD in APP_TIMEZONE. */
  today: string;
  /** Everything the user typed or said in this conversation, newest last (for grounding checks). */
  userText: string;
  /** The latest user message only. */
  latestText: string;
  draft: ToolDraft | null;
  /** The request came from a "fill in the form" button: return a card even when details are missing. */
  form: boolean;
  /**
   * The arguments were built by the server, not the model: a chip or a button (from an earlier,
   * already checked turn), or a follow-up reply the server read itself (`fillFromReply`). So
   * "did the user say this?" checks are skipped.
   */
  fromButton: boolean;
  /** This call was handed over by another tool's prepare() (see Prepared 'reroute'). */
  rerouted?: boolean;
  /** The page the drawer is on ("/expenses?tab=summary"), or the assistant's own page. */
  page?: string;
  /** The organization's plan, for which pages exist (navigation). */
  subscription?: SubscriptionState;
}

export interface PendingActionView {
  tool: string;
  args: Record<string, unknown>;
  calls: ApiCall[];
  meta: Record<string, unknown>;
}

export interface AiTool<A = Record<string, unknown>> {
  name: string;
  /** What the model reads to choose the tool. */
  description: string;
  /** Shown while the tool runs: "Searching employees". */
  label: string;
  kind: 'read' | 'write';
  /** Never sent to the model, or run, for an ORG_USER. */
  adminOnly?: boolean;
  /** A permission-matrix action on the module's own permission module (e.g. projects: 'create'). */
  requires?: PermissionAction;
  /** What the model fills in: names and the user's own words, never ids. */
  input: z.ZodType<A, z.ZodTypeDef, unknown>;
  // read tools
  run?: (args: A, api: ApiClient, ctx: ToolContext) => Promise<AiResult>;
  // write tools
  prepare?: (args: A, api: ApiClient, ctx: ToolContext) => Promise<Prepared>;
  /** Fills a waiting draft from a plain reply without the model ("mike@company.com"). Null = needs the model. */
  fillFromReply?: (draft: ToolDraft, reply: string, api: ApiClient, ctx: ToolContext) => Promise<Record<string, unknown> | null>;
  /**
   * Builds the calls again from values the user edited on the card. Throws AiUserError when they are
   * invalid. `hasFile`: a file was chosen on the card (a receipt the edited amount now needs).
   */
  revise?: (pending: PendingActionView, values: unknown, api: ApiClient, ctx: ToolContext, hasFile: boolean) => Promise<ApiCall[]>;
  /** The reply after the calls succeeded. */
  done?: (results: unknown[], pending: PendingActionView) => AiResult;
  /**
   * The reply when a later call failed after earlier ones succeeded (the claim was made, its submit
   * failed). The card is closed then, so Confirm can't run the first calls again.
   */
  partial?: (results: unknown[], error: string, pending: PendingActionView) => AiResult;
}

export interface PromptContext {
  userName: string;
  role: AuthenticatedUser['role'];
  today: string;
  weekday: string;
  /** Names of the tools this user may use, so the prompt only mentions what they can do. */
  tools: string[];
}

/** Shown only when the user may use its tool. */
export interface StarterChip {
  label: string;
  toolCall: ToolCallRef;
}

export interface AiModule {
  key: string;
  title: string;
  /** One line under the title in the chat drawer. */
  intro: (role: AuthenticatedUser['role']) => string;
  starters: StarterChip[];
  systemPrompt: (ctx: PromptContext) => string;
  tools: AiTool<any>[];
  /**
   * A message the server can act on without the model, e.g. a plain "Download employees and
   * projects": the tool call to run, or null to ask the model. Saves seconds per request on a CPU.
   */
  direct?: (message: string, ctx: ToolContext) => ToolCallRef | null;
  /** A plan feature needed on top of 'ai'. */
  requiredFeature?: PlanFeature;
  /** A permission-matrix right needed to use the module at all (ORG_ADMIN always passes). */
  requiredPermission?: { module: ModuleName; action: PermissionAction };
  /** Only for ORG_ADMIN, as its page is (Roles): not offered to anyone else at all. */
  adminOnly?: boolean;
  /**
   * A message that is another page's work ("Apply leave" on the Attendance tab): the line that
   * says where, answered before any tool runs. Null when it's this page's.
   */
  elsewhere?: (message: string) => string | null;
  /**
   * Pages (navigation keys) whose "show" this module answers itself, though they are other pages:
   * "Show my profile" on the Profile tab means the details there, not the My profile page.
   */
  shows?: string[];
}

/** A failure the user should read as-is ("No department called 'Enginering'"). */
export class AiUserError extends Error {
  constructor(message: string, readonly details?: unknown) {
    super(message);
    this.name = 'AiUserError';
  }
}
