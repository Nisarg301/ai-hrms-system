export interface Holiday {
  id: string;
  name: string;
  /** YYYY-MM-DD */
  date: string;
  description: string;
}

export interface HolidayPayload {
  name: string;
  /** YYYY-MM-DD */
  date: string;
  description: string;
}
