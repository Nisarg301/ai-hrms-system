import { Types } from 'mongoose';
import { IHoliday } from '../models/holiday.model';
import { holidayRepository } from '../repositories/holiday.repository';

export type HolidayView = ReturnType<typeof toHolidayView>;

export function toHolidayView(h: IHoliday) {
  return { id: h._id!.toString(), name: h.name, date: h.date, description: h.description };
}

export const holidayService = {
  /** The organization's holiday dates within [from, to], for working-day counting. */
  async datesBetween(organizationId: Types.ObjectId | string, from: string, to: string): Promise<Set<string>> {
    const holidays = await holidayRepository.find({ organizationId, date: { $gte: from, $lte: to } });
    return new Set(holidays.map((h) => h.date));
  },

  /** The next `limit` holidays on or after `from`, soonest first. */
  async upcoming(organizationId: Types.ObjectId, from: string, limit: number): Promise<HolidayView[]> {
    const holidays = await holidayRepository.find({ organizationId, date: { $gte: from } });
    holidays.sort((a, b) => a.date.localeCompare(b.date));
    return holidays.slice(0, limit).map(toHolidayView);
  },
};
