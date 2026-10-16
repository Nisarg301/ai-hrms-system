import { callApiServices } from '../callApiServices';
import type { ListParams } from '../../types/api';
import type { ProjectPayload, ProjectRow } from '../../types/project';

export function listProjectsRequest(params: ListParams) {
  return callApiServices<ProjectRow[]>('/projects', 'get', true, params);
}

export function createProjectRequest(payload: ProjectPayload) {
  return callApiServices<ProjectRow>('/projects', 'post', true, payload);
}

export function updateProjectRequest(id: string, payload: Partial<ProjectPayload>) {
  return callApiServices<ProjectRow>(`/projects/${id}`, 'put', true, payload);
}

export function deleteProjectRequest(id: string) {
  return callApiServices<{ id: string; deleted: boolean }>(`/projects/${id}`, 'delete', true);
}
