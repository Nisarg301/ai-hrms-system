import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { requireOrgAdmin } from '../middlewares/authorize';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import { createAttendanceRequestSchema, decideAttendanceSchema, recordFixSchema, updateSettingsSchema } from '../validators/attendance.validators';
import * as attendanceController from '../controllers/attendance.controller';
import * as requestController from '../controllers/attendanceRequest.controller';

const router = Router();

// Every member clocks in and sees their own attendance; ORG_ADMIN sets the schedule.
router.use(authenticate, scopeToOrganization, requireActivePlan);
router.get('/settings', attendanceController.getAttendanceSettings);
router.put('/settings', requireOrgAdmin, validate(updateSettingsSchema), attendanceController.updateAttendanceSettings);
router.get('/today', attendanceController.getToday);
router.post('/clock-in', attendanceController.postClockIn);
router.post('/clock-out', attendanceController.postClockOut);
router.get('/me', attendanceController.getMyMonth);

// Fixes and work from home: any member for their own.
router.post('/requests', validate(createAttendanceRequestSchema), requestController.createAttendanceRequest);
router.get('/requests/mine', requestController.myAttendanceRequests);
router.post('/requests/:id/cancel', validateObjectId(), requestController.cancelMyAttendanceRequest);

// ORG_ADMIN: decide requests, fix someone's day, see the team.
router.get('/requests', requireOrgAdmin, requestController.listAttendanceRequests);
router.get('/pending-count', requireOrgAdmin, requestController.attendancePendingCount);
router.post('/requests/record', requireOrgAdmin, validate(recordFixSchema), requestController.recordAttendanceFix);
router.post('/requests/:id/approve', requireOrgAdmin, validateObjectId(), validate(decideAttendanceSchema), requestController.approveAttendanceRequest);
router.post('/requests/:id/reject', requireOrgAdmin, validateObjectId(), validate(decideAttendanceSchema), requestController.rejectAttendanceRequest);
router.get('/team', requireOrgAdmin, requestController.teamDay);
router.get('/team/month', requireOrgAdmin, requestController.teamMonth);

export default router;
