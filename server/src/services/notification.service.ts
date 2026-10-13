import { Types } from 'mongoose';
import { NotificationModel, NotificationType } from '../models/notification.model';

type Id = Types.ObjectId | string;

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body?: string;
  link: string;
}

/**
 * Drops a notification into each recipient's bell, except `except` (whoever caused
 * it: nobody needs a bell for their own action). Never throws: a notification that
 * fails to save must not undo or fail the action it's about.
 */
export async function notify(organizationId: Id, userIds: Id[], input: NotificationInput, except?: Id): Promise<void> {
  const recipients = [...new Set(userIds.map(String))].filter((id) => !except || id !== String(except));
  if (recipients.length === 0) return;
  try {
    await NotificationModel.insertMany(
      recipients.map((userId) => ({
        organizationId: new Types.ObjectId(String(organizationId)),
        userId: new Types.ObjectId(userId),
        type: input.type,
        title: input.title,
        body: input.body ?? '',
        link: input.link,
      }))
    );
  } catch (err) {
    console.error('Could not save notifications', err);
  }
}

// ---------------------------------------------------------------- wording

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "6 Oct 2026", "6–8 Oct 2026", "30 Sep – 2 Oct 2026". */
export function formatDates(startDate: string, endDate: string = startDate): string {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  if (startDate === endDate) return `${sd} ${MONTHS[sm - 1]} ${sy}`;
  if (sy === ey && sm === em) return `${sd}–${ed} ${MONTHS[em - 1]} ${ey}`;
  if (sy === ey) return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]} ${ey}`;
  return `${sd} ${MONTHS[sm - 1]} ${sy} – ${ed} ${MONTHS[em - 1]} ${ey}`;
}

export function days(n: number): string {
  return `${n} day${n === 1 ? '' : 's'}`;
}

/** A single line of at most `max` characters, for bodies that quote free text. */
export function snippet(text: string, max = 120): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
