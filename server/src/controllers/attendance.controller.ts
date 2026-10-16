import { Request, Response } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler';
import { AttendanceSettingsModel } from '../models/attendanceSettings.model';
import { auditCrud } from '../services/audit.service';
import { clockIn, clockOut, getSettings, myMonth, today, toSchedule } from '../services/attendance.service';
import { monthQuerySchema } from '../validators/attendance.validators';
import { successResponse, ApiError } from '../utils/apiResponse';
import { now, todayIso } from '../utils/dates';

export const getAttendanceSettings = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json(successResponse(toSchedule(await getSettings(req.orgFilter!.organizationId))));
});

export const updateAttendanceSettings = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  await getSettings(organizationId);
  const updated = await AttendanceSettingsModel.findOneAndUpdate(
    { organizationId },
    { $set: { ...req.body, updatedBy: req.user!.id } },
    { returnDocument: 'after' }
  );
  const s = toSchedule(updated!);
  await auditCrud(req, 'update', 'attendance', {
    id: String(updated!._id),
    label: `Schedule ${s.shiftStart}–${s.shiftEnd}, grace ${s.graceMinutes}m, full ${s.fullDayMinutes}m, half ${s.halfDayMinutes}m`,
  });
  res.status(200).json(successResponse(s));
});

export const getToday = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json(successResponse(await today(req.orgFilter!.organizationId, req.user!.id, now())));
});

export const postClockIn = asyncHandler(async (req: Request, res: Response) => {
  const at = now();
  await clockIn(req.orgFilter!.organizationId, req.user!.id, at);
  res.status(201).json(successResponse(await today(req.orgFilter!.organizationId, req.user!.id, at)));
});

export const postClockOut = asyncHandler(async (req: Request, res: Response) => {
  const at = now();
  await clockOut(req.orgFilter!.organizationId, req.user!.id, at);
  res.status(200).json(successResponse(await today(req.orgFilter!.organizationId, req.user!.id, at)));
});

/** My month, day by day (?month=YYYY-MM, default: this month). */
export const getMyMonth = asyncHandler(async (req: Request, res: Response) => {
  const parsed = monthQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());
  const at = now();
  const month = parsed.data.month ?? todayIso(at).slice(0, 7);
  res.status(200).json(successResponse(await myMonth(req.orgFilter!.organizationId, req.user!.id, month, at)));
});
