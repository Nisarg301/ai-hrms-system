import { HolidayModel, IHoliday } from '../models/holiday.model';
import { BaseRepository } from './base.repository';

export class HolidayRepository extends BaseRepository<IHoliday> {
  constructor() {
    super(HolidayModel);
  }
}

export const holidayRepository = new HolidayRepository();
