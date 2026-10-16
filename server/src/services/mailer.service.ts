import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';

let transporterPromise: Promise<Transporter> | null = null;

async function createTransporter(): Promise<Transporter> {
  if (env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 587,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  const account = await nodemailer.createTestAccount();
  console.log(`[mail] No SMTP_HOST set: using Ethereal test inbox ${account.user}`);
  return nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: { user: account.user, pass: account.pass },
  });
}

/** Mail failures are logged, never thrown: an invite must not fail because SMTP is down. */
async function send(to: string, subject: string, text: string): Promise<void> {
  if (env.NODE_ENV === 'test') return;
  try {
    transporterPromise ??= createTransporter();
    const info = await (await transporterPromise).sendMail({ from: env.MAIL_FROM, to, subject, text });
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) console.log(`[mail] "${subject}" to ${to}: ${preview}`);
  } catch (err) {
    // A failed Ethereal account creation shouldn't stick; try again next time.
    transporterPromise = null;
    console.error(`[mail] Failed to send "${subject}" to ${to}`, err);
  }
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

export const mailerService = {
  async sendTempPasswordEmail(to: string, tempPassword: string): Promise<void> {
    await send(
      to,
      'Your Sentinel account',
      `An account was created for you.\n\nTemporary password: ${tempPassword}\n\nSign in at ${env.CORS_ORIGIN}/login. You'll be asked to choose a new password.`
    );
  },

  async sendPasswordResetEmail(to: string, resetToken: string): Promise<void> {
    await send(
      to,
      'Reset your Sentinel password',
      `Use this token to reset your password. It is valid for 15 minutes.\n\n${resetToken}\n\n${env.CORS_ORIGIN}/reset-password\n\nIf you didn't ask for this, you can ignore this email.`
    );
  },

  async sendLeaveRequestedEmail(
    to: string,
    details: { employeeName: string; typeName: string; startDate: string; endDate: string; days: number; reason: string }
  ): Promise<void> {
    const when = details.startDate === details.endDate ? details.startDate : `${details.startDate} to ${details.endDate}`;
    await send(
      to,
      `Leave request: ${details.employeeName}, ${details.typeName} (${details.days} day${details.days === 1 ? '' : 's'})`,
      `${details.employeeName} has applied for ${details.typeName}: ${when} (${details.days} working day${details.days === 1 ? '' : 's'}).${details.reason ? `\n\nReason: ${details.reason}` : ''}\n\nReview it: ${env.CORS_ORIGIN}/leave/approvals`
    );
  },

  async sendLeaveDecisionEmail(
    to: string,
    details: { status: 'approved' | 'rejected'; typeName: string; startDate: string; endDate: string; days: number; note: string }
  ): Promise<void> {
    const when = details.startDate === details.endDate ? details.startDate : `${details.startDate} to ${details.endDate}`;
    await send(
      to,
      `Your ${details.typeName} request was ${details.status}`,
      `Your ${details.typeName} request for ${when} (${details.days} working day${details.days === 1 ? '' : 's'}) was ${details.status}.${details.note ? `\n\nNote: ${details.note}` : ''}\n\nSee your leave: ${env.CORS_ORIGIN}/me/leave`
    );
  },

  async sendLeaveRecordedEmail(
    to: string,
    details: { adminName: string; typeName: string; startDate: string; endDate: string; days: number; reason: string }
  ): Promise<void> {
    const when = details.startDate === details.endDate ? details.startDate : `${details.startDate} to ${details.endDate}`;
    await send(
      to,
      `${details.adminName} recorded ${details.typeName} for you`,
      `${details.adminName} recorded ${details.typeName} for you on ${when} (${details.days} working day${details.days === 1 ? '' : 's'}). It's already approved.${details.reason ? `\n\nReason: ${details.reason}` : ''}\n\nSee your leave: ${env.CORS_ORIGIN}/me/leave`
    );
  },

  /** To each ORG_ADMIN: someone asked for an attendance fix or work from home. */
  async sendAttendanceRequestedEmail(to: string, details: { employeeName: string; summary: string; reason: string }): Promise<void> {
    await send(
      to,
      `Attendance request: ${details.employeeName}, ${details.summary}`,
      `${details.employeeName} asked for: ${details.summary}.${details.reason ? `\n\nReason: ${details.reason}` : ''}\n\nReview it: ${env.CORS_ORIGIN}/leave/approvals`
    );
  },

  /** To the employee: their fix / WFH was decided, or an admin recorded a fix for them. */
  async sendAttendanceDecisionEmail(
    to: string,
    details: { status: 'approved' | 'rejected' | 'recorded'; summary: string; note: string; adminName: string }
  ): Promise<void> {
    const subject =
      details.status === 'recorded' ? `${details.adminName} fixed your attendance` : `Your attendance request was ${details.status}`;
    const body =
      details.status === 'recorded'
        ? `${details.adminName} recorded: ${details.summary}. It's already approved.`
        : `Your request (${details.summary}) was ${details.status}.`;
    await send(to, subject, `${body}${details.note ? `\n\nNote: ${details.note}` : ''}\n\nSee your attendance: ${env.CORS_ORIGIN}/me/attendance`);
  },

  /** To each ORG_ADMIN: a claim is waiting for approval. */
  async sendExpenseSubmittedEmail(
    to: string,
    details: { employeeName: string; number: string; title: string; total: string; itemCount: number }
  ): Promise<void> {
    await send(
      to,
      `Expense claim ${details.number}: ${details.employeeName}, ${details.total}`,
      `${details.employeeName} submitted ${details.number} "${details.title}": ${details.itemCount} expense${details.itemCount === 1 ? '' : 's'}, ${details.total}.\n\nReview it: ${env.CORS_ORIGIN}/leave/approvals?tab=expenses`
    );
  },

  /** To the employee: approved, rejected, or paid. */
  async sendExpenseUpdateEmail(
    to: string,
    details: { status: 'approved' | 'rejected' | 'paid'; number: string; title: string; total: string; note: string; paidOn?: string; reference?: string }
  ): Promise<void> {
    const what =
      details.status === 'paid'
        ? `was paid on ${details.paidOn} (reference ${details.reference})`
        : `was ${details.status}`;
    await send(
      to,
      `Your expense claim ${details.number} ${details.status === 'paid' ? 'was paid' : `was ${details.status}`}`,
      `Your claim ${details.number} "${details.title}" for ${details.total} ${what}.${details.note ? `\n\nNote: ${details.note}` : ''}\n\nSee your expenses: ${env.CORS_ORIGIN}/me/expenses`
    );
  },

  /** When a process starts, to someone with tasks in it, if any is due within 3 days. */
  async sendLifecycleTasksEmail(
    to: string,
    details: { employeeName: string; kind: 'onboarding' | 'offboarding'; isOwn: boolean; tasks: { title: string; due: string }[] }
  ): Promise<void> {
    const n = details.tasks.length;
    const tasks = `${n} ${details.kind} task${n === 1 ? '' : 's'}`;
    const subject = details.isOwn
      ? details.kind === 'onboarding'
        ? `Welcome aboard! You have ${tasks}`
        : `Your offboarding has started: ${n} task${n === 1 ? '' : 's'}`
      : `${tasks[0].toUpperCase()}${tasks.slice(1)} for ${details.employeeName}`;
    const intro = details.isOwn ? `Here's what to do:` : `You have ${tasks} for ${details.employeeName}:`;
    const lines = details.tasks.map((t) => `- ${t.title} (due ${t.due})`).join('\n');
    await send(to, subject, `${intro}\n\n${lines}\n\nOpen them: ${env.CORS_ORIGIN}/home`);
  },

  /** The daily digest: one email listing everything due tomorrow or overdue. */
  async sendLifecycleDigestEmail(to: string, details: { items: { title: string; whose: string; due: string; overdue: boolean }[] }): Promise<void> {
    const n = details.items.length;
    const lines = details.items.map((i) => `- ${i.title}, ${i.whose}: ${i.overdue ? `overdue since ${i.due}` : `due ${i.due}`}`).join('\n');
    await send(
      to,
      `${n} onboarding/offboarding task${n === 1 ? ' needs' : 's need'} you`,
      `These need doing:\n\n${lines}\n\nOpen them: ${env.CORS_ORIGIN}/home`
    );
  },

  /** The daily review reminder: one email listing every part due today or in two days. */
  async sendPerformanceDigestEmail(to: string, details: { items: { label: string; due: string }[] }): Promise<void> {
    const n = details.items.length;
    const lines = details.items.map((i) => `- ${i.label}: ${i.due}`).join('\n');
    await send(to, `${n} review${n === 1 ? '' : 's'} to finish`, `Reviews due soon:\n\n${lines}\n\nOpen them: ${env.CORS_ORIGIN}/me/performance`);
  },

  async sendPlanExpiryReminder(to: string, details: { organizationName: string; planName: string; expiryDate: Date }): Promise<void> {
    const date = formatDate(details.expiryDate);
    await send(
      to,
      `Your ${details.planName} plan expires on ${date}`,
      `The ${details.planName} plan for ${details.organizationName} expires on ${date}.\n\nAfter that, nobody in your organization can use Sentinel until the plan is renewed.\n\nRenew now: ${env.CORS_ORIGIN}/billing`
    );
  },
};
