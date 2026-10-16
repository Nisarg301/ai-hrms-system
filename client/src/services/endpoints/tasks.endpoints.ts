import { callApiServices } from '../callApiServices';
import type { ListParams } from '../../types/api';
import type { TaskPayload, TaskRow } from '../../types/task';

export function listTasksRequest(params: ListParams) {
  return callApiServices<TaskRow[]>('/tasks', 'get', true, params);
}

export function createTaskRequest(payload: TaskPayload) {
  return callApiServices<TaskRow>('/tasks', 'post', true, payload);
}

export function updateTaskRequest(id: string, payload: Partial<TaskPayload>) {
  return callApiServices<TaskRow>(`/tasks/${id}`, 'put', true, payload);
}

export function deleteTaskRequest(id: string) {
  return callApiServices<{ id: string; deleted: boolean }>(`/tasks/${id}`, 'delete', true);
}
