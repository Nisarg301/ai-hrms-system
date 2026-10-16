import { LeaveRequestModel, ILeaveRequest } from '../models/leaveRequest.model';
import { BaseRepository } from './base.repository';

export class LeaveRequestRepository extends BaseRepository<ILeaveRequest> {
  constructor() {
    super(LeaveRequestModel);
  }
}

export const leaveRequestRepository = new LeaveRequestRepository();
