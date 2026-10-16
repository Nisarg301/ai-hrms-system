export type ProjectStatus = 'planning' | 'active' | 'completed' | 'on-hold';

export interface ProjectRow {
  id: string;
  name: string;
  description: string;
  deadline: string;
  status: ProjectStatus;
}

export interface ProjectPayload {
  name: string;
  description: string;
  deadline: string;
  status: ProjectStatus;
}
