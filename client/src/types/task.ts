export type TaskStatus = 'todo' | 'in-progress' | 'done' | 'blocked';

export interface TaskRow {
  id: string;
  projectId?: string;
  projectName?: string;
  userId?: string[];
  userName?: string;
  title: string;
  description: string;
  dueDate: string;
  status: TaskStatus;
}

export interface TaskPayload {
  title: string;
  description: string;
  dueDate: string;
  status: TaskStatus;
  projectId: string;
  userId?: string[];
}
