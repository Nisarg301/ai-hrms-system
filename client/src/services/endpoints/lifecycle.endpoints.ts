import { callApiServices } from '../callApiServices';
import type {
  AddTaskPayload,
  AdminProcess,
  AssignedGroup,
  ChecklistTemplate,
  CompleteTaskPayload,
  LifecycleKind,
  LifecycleTask,
  MyLifecycle,
  ProcessDetail,
  ProcessStatus,
  StartOffboardingPayload,
  StartOnboardingPayload,
  TemplatePayload,
  UpdateTaskPayload,
} from '../../types/lifecycle';
import type { Person } from '../../types/people';

export function getMyLifecycleRequest() {
  return callApiServices<MyLifecycle[]>('/lifecycle/mine', 'get', true);
}

export function getAssignedTasksRequest() {
  return callApiServices<AssignedGroup[]>('/lifecycle/tasks/assigned-to-me', 'get', true);
}

export function completeTaskRequest(taskId: string, payload: CompleteTaskPayload) {
  return callApiServices<LifecycleTask>(`/lifecycle/tasks/${taskId}/complete`, 'post', true, payload);
}

export function uploadTaskFileRequest(taskId: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return callApiServices<LifecycleTask>(`/lifecycle/tasks/${taskId}/files`, 'post', true, form);
}

/** The file itself (the API needs the login token, so it's fetched rather than linked). */
export function getTaskFileRequest(taskId: string, fileId: string) {
  return callApiServices<Blob>(`/lifecycle/tasks/${taskId}/files/${fileId}`, 'get', true, undefined, 'blob');
}

export function deleteTaskFileRequest(taskId: string, fileId: string) {
  return callApiServices<LifecycleTask>(`/lifecycle/tasks/${taskId}/files/${fileId}`, 'delete', true);
}

// ---------------------------------------------------------------- ORG_ADMIN: processes

/** Who a process can be started for: new joiners not yet onboarded, or anyone not already leaving. */
export function getCandidatesRequest(kind: LifecycleKind) {
  return callApiServices<Person[]>('/lifecycle/candidates', 'get', true, { kind });
}

export function listProcessesRequest(params: { kind: LifecycleKind; status?: ProcessStatus; page: number; limit: number }) {
  return callApiServices<AdminProcess[]>('/lifecycle', 'get', true, params);
}

export function getProcessRequest(id: string) {
  return callApiServices<ProcessDetail>(`/lifecycle/${id}`, 'get', true);
}

export function startOnboardingRequest(payload: StartOnboardingPayload) {
  return callApiServices<ProcessDetail>('/lifecycle/onboarding', 'post', true, payload);
}

export function startOffboardingRequest(payload: StartOffboardingPayload) {
  return callApiServices<ProcessDetail>('/lifecycle/offboarding', 'post', true, payload);
}

export function completeProcessRequest(id: string, skipRemaining: boolean) {
  return callApiServices<ProcessDetail>(`/lifecycle/${id}/complete`, 'post', true, { skipRemaining });
}

export function cancelProcessRequest(id: string, reason: string) {
  return callApiServices<ProcessDetail>(`/lifecycle/${id}/cancel`, 'post', true, { reason });
}

export function addTaskRequest(processId: string, payload: AddTaskPayload) {
  return callApiServices<ProcessDetail>(`/lifecycle/${processId}/tasks`, 'post', true, payload);
}

export function updateTaskRequest(taskId: string, payload: UpdateTaskPayload) {
  return callApiServices<ProcessDetail>(`/lifecycle/tasks/${taskId}`, 'put', true, payload);
}

export function skipTaskRequest(taskId: string, reason: string) {
  return callApiServices<ProcessDetail>(`/lifecycle/tasks/${taskId}/skip`, 'post', true, { reason });
}

// ---------------------------------------------------------------- ORG_ADMIN: templates

export function listTemplatesRequest(kind?: LifecycleKind) {
  return callApiServices<ChecklistTemplate[]>('/checklist-templates', 'get', true, kind ? { kind } : undefined);
}

export function createTemplateRequest(payload: TemplatePayload) {
  return callApiServices<ChecklistTemplate>('/checklist-templates', 'post', true, payload);
}

export function updateTemplateRequest(id: string, payload: Omit<TemplatePayload, 'kind'>) {
  return callApiServices<ChecklistTemplate>(`/checklist-templates/${id}`, 'put', true, payload);
}

export function deleteTemplateRequest(id: string) {
  return callApiServices<{ id: string; deleted: boolean }>(`/checklist-templates/${id}`, 'delete', true);
}

export function makeDefaultTemplateRequest(id: string) {
  return callApiServices<ChecklistTemplate>(`/checklist-templates/${id}/make-default`, 'post', true);
}
