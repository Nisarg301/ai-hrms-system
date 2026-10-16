import { TaskModel, ITaskRecord } from '../models/task.model';
import { BaseRepository } from './base.repository';

export class TaskRepository extends BaseRepository<ITaskRecord> {
  constructor() {
    super(TaskModel);
  }
}

export const taskRepository = new TaskRepository();
