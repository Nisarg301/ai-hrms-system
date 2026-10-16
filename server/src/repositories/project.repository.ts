import { ProjectModel, IProjectRecord } from '../models/project.model';
import { BaseRepository } from './base.repository';

export class ProjectRepository extends BaseRepository<IProjectRecord> {
  constructor() {
    super(ProjectModel);
  }
}

export const projectRepository = new ProjectRepository();
