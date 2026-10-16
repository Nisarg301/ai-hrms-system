import { DepartmentModel, IDepartmentRecord } from '../models/department.model';
import { BaseRepository } from './base.repository';

export class DepartmentRepository extends BaseRepository<IDepartmentRecord> {
    constructor() {
        super(DepartmentModel);
    }
}

export const departmentRepository = new DepartmentRepository();
