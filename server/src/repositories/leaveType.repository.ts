import { LeaveTypeModel, ILeaveType } from '../models/leaveType.model';
import { BaseRepository } from './base.repository';

export class LeaveTypeRepository extends BaseRepository<ILeaveType> {
  constructor() {
    super(LeaveTypeModel);
  }
}

export const leaveTypeRepository = new LeaveTypeRepository();
