// Mirrors server/src/ai/types.ts and agent.service.ts (the AI assistant's API).

import type { PermissionEntry } from './role';

export interface AiToolCallRef {
  name: string;
  args: Record<string, unknown>;
  /** Open the tool's form card instead of asking questions. */
  form?: boolean;
}

export interface AiButton {
  label: string;
  toolCall: AiToolCallRef;
}

export interface AiTable {
  columns: { key: string; title: string }[];
  rows: Record<string, string>[];
}

/** A file to download from the API with the user's own token (an export's CSV). */
export interface AiDownload {
  /** "Employees CSV". */
  label: string;
  /** Relative to the API base, e.g. "/exports/employees". */
  path: string;
}

/** An assistant answer. `text` may contain **bold**. */
export interface AiResult {
  text: string;
  table?: AiTable;
  buttons?: AiButton[];
  warnings?: string[];
  downloads?: AiDownload[];
  /** Start the downloads when the answer arrives live (never for one loaded from history). */
  autoDownload?: boolean;
  /** The page behind the drawer follows a live answer: a path with its filters ("/expenses?tab=summary&from=…"). */
  view?: string;
}

/** The employee form on a confirm card: ids, not names; '' = empty. */
export interface AiEmployeeFormValues {
  name: string;
  email: string;
  jobTitle: string;
  department: string;
  roleId: string;
  status?: 'active' | 'disabled';
  reportsTo: string;
  joiningDate: string;
  dateOfBirth: string;
}

/** The project form on a confirm card. `deadline` is a YYYY-MM-DD day or ''. */
export interface AiProjectFormValues {
  name: string;
  description: string;
  deadline: string;
  status: 'planning' | 'active' | 'completed' | 'on-hold';
}

/** The department form on a confirm card. */
export interface AiDepartmentFormValues {
  title: string;
  description: string;
  status: 'active' | 'inactive';
}

/** The task form on a confirm card: ids, not names; `dueDate` is a YYYY-MM-DD day or ''. */
export interface AiTaskFormValues {
  title: string;
  description: string;
  dueDate: string;
  status: 'todo' | 'in-progress' | 'done' | 'blocked';
  projectId: string;
  /** The members. */
  userId: string[];
}

/** The document form on a confirm card. The file is chosen separately, on the card. */
export interface AiDocumentFormValues {
  title: string;
  description: string;
  category: string;
  status: 'active' | 'archived';
}

/** Values of the editable role form: the name, and one entry per module that has Read. */
export interface AiRoleFormValues {
  name: string;
  permissions: PermissionEntry[];
}

/** Values of the editable expense category form, in rupees as on the Categories tab. */
export interface AiCategoryFormValues {
  name: string;
  /** null = no limit. */
  limitRupees: number | null;
  /** 0 = a receipt is always needed. */
  receiptAboveRupees: number;
  isActive: boolean;
}

/** The leave form: dates are YYYY-MM-DD, and a half day is one date. */
export interface AiLeaveFormValues {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  halfDay: 'first' | 'second' | null;
  reason: string;
}

export interface AiLeaveTypeOption {
  id: string;
  name: string;
  isPaid: boolean;
  allowHalfDay: boolean;
  /** null = unlimited. */
  available: number | null;
}

export interface AiWfhFormValues {
  startDate: string;
  endDate: string;
  reason: string;
}

/** Times are HH:mm, 24-hour. */
export interface AiFixFormValues {
  date: string;
  clockIn: string;
  clockOut: string;
  reason: string;
}

/** A claim's form: its title (for a new claim only), one expense, and whether to submit it now. */
export interface AiClaimFormValues {
  title: string;
  date: string;
  categoryId: string;
  amountRupees: number | null;
  merchant: string;
  note: string;
  submitNow: boolean;
}

export interface AiClaimCategoryOption {
  id: string;
  name: string;
  /** null = no limit. */
  limitPaise: number | null;
  /** 0 = a receipt is always needed. */
  receiptRequiredAbovePaise: number;
}

export type AiCardForm =
  | { kind: 'employee'; mode: 'create' | 'update'; values: AiEmployeeFormValues }
  | { kind: 'role'; mode: 'create' | 'update'; values: AiRoleFormValues }
  | { kind: 'category'; mode: 'create' | 'update'; values: AiCategoryFormValues }
  | { kind: 'leave'; mode: 'create'; values: AiLeaveFormValues; types: AiLeaveTypeOption[] }
  | { kind: 'wfh'; mode: 'create'; values: AiWfhFormValues }
  | { kind: 'fix'; mode: 'create'; values: AiFixFormValues }
  /** `categories`: the active ones with their rules, so the form knows when a receipt is needed. */
  | { kind: 'claim'; mode: 'create' | 'update'; values: AiClaimFormValues; categories: AiClaimCategoryOption[] }
  /** `categories`: the ones in use, for the form to suggest. */
  | { kind: 'document'; mode: 'create' | 'update'; values: AiDocumentFormValues; categories: string[] }
  | { kind: 'project'; mode: 'create' | 'update'; values: AiProjectFormValues }
  | { kind: 'department'; mode: 'create' | 'update'; values: AiDepartmentFormValues }
  /** `labels`: id → name for the project and members on the card, in case the form's lists lack them. */
  | { kind: 'task'; mode: 'create' | 'update'; values: AiTaskFormValues; labels: Record<string, string> };

/** Values sent back with Confirm when the card's form was edited. */
export type AiFormValues =
  | AiEmployeeFormValues
  | AiRoleFormValues
  | AiCategoryFormValues
  | AiLeaveFormValues
  | AiWfhFormValues
  | AiFixFormValues
  | AiClaimFormValues
  | AiProjectFormValues
  | AiDepartmentFormValues
  | AiTaskFormValues
  | AiDocumentFormValues;

export interface AiConfirmCard {
  title: string;
  tone: 'default' | 'danger';
  rows: { label: string; value: string; previous?: string }[];
  warnings?: string[];
  notes?: string[];
  confirmLabel: string;
  form?: AiCardForm;
  /** Some required values are missing: the form must be completed before Confirm. */
  incomplete?: boolean;
  /**
   * A file field: chosen here and sent with the Confirm click. `current`: the file there now.
   * `kind`: what the endpoint takes (documents: PDF, Word, JPG, PNG; receipts: PDF, JPG, PNG).
   */
  file?: { required: boolean; current?: string; kind?: 'document' | 'receipt' };
}

export type AiActionStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired';

export interface AiAction {
  id: string;
  tool: string;
  card: AiConfirmCard;
  status: AiActionStatus;
  resultText: string | null;
}

export interface AiChatMessage {
  role: 'user' | 'assistant';
  text: string;
  result: AiResult | null;
  action: AiAction | null;
  createdAt: string;
  /** Client only: arrived in this session's stream, not loaded from history. */
  live?: boolean;
}

export interface AiModuleInfo {
  key: string;
  title: string;
  intro: string;
  starters: { label: string; toolCall: AiToolCallRef }[];
}

export interface AiConversationSummary {
  id: string;
  module: string;
  updatedAt: string;
  preview: string;
}

export interface AiConversation {
  id: string;
  module: string;
  updatedAt: string;
  messages: AiChatMessage[];
}

export interface AiConfirmResult {
  message: AiChatMessage;
  action: AiAction;
  /** Shown once (a new employee's temporary password); never stored. */
  secrets: { label: string; value: string }[];
}

/** Server-sent events of POST /ai/chat. */
export type AiStreamEvent =
  | { type: 'status'; state: 'queued' | 'thinking'; ahead?: number }
  | { type: 'tool'; name: string; label: string }
  | { type: 'token'; text: string }
  | { type: 'message'; message: AiChatMessage }
  | { type: 'done'; conversationId: string }
  | { type: 'error'; message: string; code?: string };

export interface AiChatRequest {
  module: string;
  conversationId?: string;
  message?: string;
  toolCall?: AiToolCallRef & { label?: string };
}
