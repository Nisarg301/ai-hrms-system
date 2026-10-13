import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { holidayRepository } from '../repositories/holiday.repository';
import { listHolidaysQuerySchema } from '../validators/holiday.validators';
import { auditCrud } from '../services/audit.service';
import { toHolidayView } from '../services/holiday.service';
import { successResponse, ApiError } from '../utils/apiResponse';
import { todayIso } from '../utils/dates';

function dateTakenError(): ApiError {
  return new ApiError(400, 'Validation failed', { fieldErrors: { date: ['There is already a holiday on this date'] } });
}

async function assertDateFree(organizationId: Types.ObjectId, date: string, exceptId?: string): Promise<void> {
  const clash = await holidayRepository.findOne({ organizationId, date, ...(exceptId ? { _id: { $ne: exceptId } } : {}) });
  if (clash) throw dateTakenError();
}

function isDuplicateKey(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: number }).code === 11000);
}

/** A year's holidays in date order (default: this year). Any member. */
export const listHolidays = asyncHandler(async (req: Request, res: Response) => {
  const parsed = listHolidaysQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ApiError(400, 'Validation failed', parsed.error.flatten());
  }
  const year = parsed.data.year ?? Number(todayIso().slice(0, 4));
  const holidays = await holidayRepository.find({
    organizationId: req.orgFilter!.organizationId,
    date: { $gte: `${year}-01-01`, $lte: `${year}-12-31` },
  });
  holidays.sort((a, b) => a.date.localeCompare(b.date));
  res.status(200).json(successResponse(holidays.map(toHolidayView), { year }));
});

export const createHoliday = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  await assertDateFree(organizationId, req.body.date);
  try {
    const holiday = await holidayRepository.create(
      { organizationId, name: req.body.name, date: req.body.date, description: req.body.description },
      req.user!.id
    );
    await auditCrud(req, 'create', 'holidays', { id: holiday._id!.toString(), label: `${holiday.name} (${holiday.date})` });
    res.status(201).json(successResponse(toHolidayView(holiday)));
  } catch (err) {
    if (isDuplicateKey(err)) throw dateTakenError(); // lost a race with a concurrent create
    throw err;
  }
});

export const updateHoliday = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const existing = await holidayRepository.findById(req.params.id, { organizationId });
  if (!existing) {
    throw new ApiError(404, 'Holiday not found');
  }
  if (req.body.date && req.body.date !== existing.date) {
    await assertDateFree(organizationId, req.body.date, req.params.id);
  }
  try {
    const updated = await holidayRepository.updateById(req.params.id, req.body, req.user!.id);
    await auditCrud(req, 'update', 'holidays', { id: req.params.id, label: `${updated!.name} (${updated!.date})` });
    res.status(200).json(successResponse(toHolidayView(updated!)));
  } catch (err) {
    if (isDuplicateKey(err)) throw dateTakenError();
    throw err;
  }
});

export const deleteHoliday = asyncHandler(async (req: Request, res: Response) => {
  const existing = await holidayRepository.findById(req.params.id, { organizationId: req.orgFilter!.organizationId });
  if (!existing) {
    throw new ApiError(404, 'Holiday not found');
  }
  await holidayRepository.softDelete(req.params.id, req.user!.id);
  await auditCrud(req, 'delete', 'holidays', { id: req.params.id, label: `${existing.name} (${existing.date})` });
  res.status(200).json(successResponse({ id: req.params.id, deleted: true }));
});
