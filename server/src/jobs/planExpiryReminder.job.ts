import cron from 'node-cron';
import { Types } from 'mongoose';
import { PLANS, PLAN_REMINDER_DAYS } from '../constants/plans';
import { organizationRepository } from '../repositories/organization.repository';
import { userRepository } from '../repositories/user.repository';
import { mailerService } from '../services/mailer.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Emails every active ORG_ADMIN of each organization whose plan ends within
 * PLAN_REMINDER_DAYS. expiryReminderSentAt makes it once per billing period:
 * it's set here and cleared whenever a payment starts a new period.
 */
export async function runPlanExpiryReminders(now: Date = new Date()): Promise<number> {
  const orgs = await organizationRepository.find({
    planActive: true,
    expiryDate: { $gt: now, $lte: new Date(now.getTime() + PLAN_REMINDER_DAYS * DAY_MS) },
    expiryReminderSentAt: null,
  });
  for (const org of orgs) {
    const admins = await userRepository.find({ organizationId: org._id, role: 'ORG_ADMIN', status: 'active' });
    for (const admin of admins) {
      await mailerService.sendPlanExpiryReminder(admin.email, {
        organizationName: org.name,
        planName: PLANS[org.planType!].name,
        expiryDate: org.expiryDate!,
      });
    }
    await organizationRepository.updateById(org._id as Types.ObjectId, { expiryReminderSentAt: now });
  }
  return orgs.length;
}

/** Daily at 09:00 IST, inside the API process (fine for a single instance). */
export function startPlanExpiryReminderJob(): void {
  cron.schedule(
    '0 9 * * *',
    () => {
      runPlanExpiryReminders()
        .then((count) => {
          if (count > 0) console.log(`[job] Sent plan expiry reminders for ${count} organization(s)`);
        })
        .catch((err) => console.error('[job] Plan expiry reminders failed', err));
    },
    { timezone: 'Asia/Kolkata' }
  );
}
