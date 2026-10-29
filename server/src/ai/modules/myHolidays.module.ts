import { z } from 'zod';
import { addDays } from '../../utils/dates';
import { basePrompt } from '../prompts/base.prompt';
import { formatDay, weekdayOf } from '../dates';
import { grounded, isBlank, norm, str } from '../text';
import { AiModule, AiResult, AiTool, ApiClient } from '../types';
import { daysUntil, holidayQuestion, HolidayQuestion, otherTab, rangeText } from './me.helpers';

// The Holidays assistant on the Me page's Holidays tab (docs/AI_ME_ASSISTANTS.md, section 9): the
// next holiday, a month, a date, a year, what's left and long weekends. Answers only, from
// GET /holidays; the tab follows the year shown (/me/holidays?year=).

interface Holiday {
  id: string;
  name: string;
  date: string;
  description: string;
}

const text = (description: string) =>
  z.preprocess((v) => (isBlank(v) ? undefined : typeof v === 'string' ? v : String(v)), z.string().optional()).describe(description);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const yearView = (year: number) => `/me/holidays?year=${year}`;
const plural = (n: number) => `${n} holiday${n === 1 ? '' : 's'}`;
const dayShort = (iso: string) => formatDay(iso).replace(/ \d{4}$/, '');

/** "today", "tomorrow", "in 17 days", "5 days ago". */
function whenText(date: string, today: string): string {
  const n = daysUntil(date, today);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

const yearOf = async (api: ApiClient, year: number) => [...(await api.get<Holiday[]>('/holidays', { year }))].sort((a, b) => a.date.localeCompare(b.date));

function table(holidays: Holiday[], today: string): AiResult['table'] {
  const next = holidays.find((h) => h.date >= today)?.id;
  return {
    columns: [
      { key: 'date', title: 'Date' },
      { key: 'name', title: 'Holiday' },
      { key: 'note', title: 'Note' },
    ],
    rows: holidays.map((h) => ({ date: formatDay(h.date), name: h.name, note: [h.date < today ? 'Past' : h.id === next ? 'Next' : '', h.description].filter(Boolean).join(' · ') || '—' })),
  };
}

/** Holidays on a Friday or a Monday make a long weekend; on a Tuesday or a Thursday, one with a day of leave. */
function longWeekends(holidays: Holiday[]): { natural: string[]; bridged: string[] } {
  const dates = new Set(holidays.map((h) => h.date));
  const natural: string[] = [];
  const bridged: string[] = [];
  for (const h of holidays) {
    const day = new Date(`${h.date}T00:00:00Z`).getUTCDay();
    if (day === 5) natural.push(`**${h.name}**, ${rangeText(h.date, addDays(h.date, 2))} (3 days)`);
    if (day === 1) natural.push(`**${h.name}**, ${rangeText(addDays(h.date, -2), h.date)} (3 days)`);
    // The day between is a holiday too: that one's own line covers it.
    if (day === 4 && !dates.has(addDays(h.date, 1))) bridged.push(`**${h.name}**: take ${formatDay(addDays(h.date, 1))} off for ${rangeText(h.date, addDays(h.date, 3))} (4 days)`);
    if (day === 2 && !dates.has(addDays(h.date, -1))) bridged.push(`**${h.name}**: take ${formatDay(addDays(h.date, -1))} off for ${rangeText(addDays(h.date, -3), h.date)} (4 days)`);
  }
  return { natural, bridged };
}

const CHANGES = /\b(?:add|create|new|delete|remove|change|edit|update|rename|move|declare)\b.*\bholidays?\b/;

const holidaysInput = z.object({ when: text('The year, month, date or holiday name exactly as the user said it, only if they gave one') });

const listHolidays: AiTool<z.infer<typeof holidaysInput>> = {
  name: 'list_holidays',
  label: 'Looking up holidays',
  kind: 'read',
  description: "Answer questions about the organization's holiday calendar: the next holiday, a month, a date, a year, holidays left, and long weekends.",
  input: holidaysInput,
  async run(args, api, ctx) {
    const today = ctx.today;
    const thisYear = Number(today.slice(0, 4));
    const words = ctx.fromButton ? (str(args.when) ?? '') : ctx.latestText;
    if (!ctx.fromButton && CHANGES.test(norm(words))) {
      return { text: ctx.user.role === 'ORG_ADMIN' ? 'Holidays are added on the **Holidays** page. Say “Go to holidays” to open it.' : "Only your organization's admin adds holidays." };
    }
    const modelWhen = !ctx.fromButton && str(args.when) && grounded(String(args.when), ctx.latestText) ? holidayQuestion(String(args.when), today) : null;
    const q: HolidayQuestion = holidayQuestion(words, today) ?? modelWhen ?? { kind: 'year', year: thisYear };

    switch (q.kind) {
      case 'next': {
        const upcoming = (await yearOf(api, thisYear)).filter((h) => h.date >= today);
        const next = upcoming[0] ?? (await yearOf(api, thisYear + 1))[0];
        if (!next) return { text: `No more holidays have been added for ${thisYear}, and none yet for ${thisYear + 1}.` };
        return { text: `The next holiday is **${next.name}** on **${formatDay(next.date)}**, ${whenText(next.date, today)}.`, view: yearView(Number(next.date.slice(0, 4))) };
      }
      case 'left': {
        const upcoming = (await yearOf(api, thisYear)).filter((h) => h.date >= today);
        if (!upcoming.length) return { text: `No holidays are left in ${thisYear}.`, view: yearView(thisYear) };
        return { text: `**${plural(upcoming.length)}** ${upcoming.length === 1 ? 'is' : 'are'} left in ${thisYear}:`, table: table(upcoming, today), view: yearView(thisYear) };
      }
      case 'long': {
        const year = q.year ?? thisYear;
        const holidays = (await yearOf(api, year)).filter((h) => year !== thisYear || h.date >= today);
        const scope = year === thisYear ? 'from today' : `in ${year}`;
        const { natural, bridged } = longWeekends(holidays);
        if (!natural.length && !bridged.length) return { text: `No long weekends ${scope}: no holiday falls next to a weekend.`, view: yearView(year) };
        const parts = [natural.length ? `Long weekends ${scope}: ${natural.join('; ')}.` : `No holiday ${scope} falls on a Monday or a Friday.`];
        if (bridged.length) parts.push(`With a day of leave: ${bridged.join('; ')}.`);
        return { text: parts.join(' '), view: yearView(year) };
      }
      case 'date': {
        const year = Number(q.date.slice(0, 4));
        const found = (await yearOf(api, year)).find((h) => h.date === q.date);
        const weekend = ['Saturday', 'Sunday'].includes(weekdayOf(q.date)) ? weekdayOf(q.date) : null;
        if (found) return { text: `Yes: **${formatDay(q.date)}** is **${found.name}**.${weekend ? ` It falls on a ${weekend}.` : ''}`, view: yearView(year) };
        return { text: `No: ${formatDay(q.date)} isn't a holiday.${weekend ? ` It's a ${weekend}, though.` : ''}`, view: yearView(year) };
      }
      case 'month': {
        const year = Number(q.month.slice(0, 4));
        const label = `${MONTHS[Number(q.month.slice(5)) - 1]} ${year}`;
        const inMonth = (await yearOf(api, year)).filter((h) => h.date.startsWith(q.month));
        if (!inMonth.length) return { text: `No holidays in ${label}.`, view: yearView(year) };
        if (inMonth.length <= 3) return { text: `**${plural(inMonth.length)}** in ${label}: ${inMonth.map((h) => `${h.name}, ${dayShort(h.date)}`).join('; ')}.`, view: yearView(year) };
        return { text: `**${plural(inMonth.length)}** in ${label}:`, table: table(inMonth, today), view: yearView(year) };
      }
      case 'named': {
        const name = norm(q.name.replace(/\b(?:this|next|last) year\b|\b20\d{2}\b/gi, ' '));
        const matches = (hs: Holiday[]) => hs.filter((h) => norm(h.name).includes(name) || name.includes(norm(h.name)));
        const now = matches(await yearOf(api, thisYear));
        const upcoming = now.find((h) => h.date >= today) ?? matches(await yearOf(api, thisYear + 1))[0];
        const found = upcoming ?? now[now.length - 1];
        if (!name || !found) return { text: `There's no holiday called “${q.name}” in ${thisYear}.`, view: yearView(thisYear) };
        const past = found.date < today;
        return { text: `**${found.name}** ${past ? 'was' : 'is'} on **${formatDay(found.date)}**, ${whenText(found.date, today)}.`, view: yearView(Number(found.date.slice(0, 4))) };
      }
      default: {
        const holidays = await yearOf(api, q.year);
        if (!holidays.length) return { text: `No holidays have been added for ${q.year} yet.`, view: yearView(q.year) };
        return { text: `**${plural(holidays.length)}** in ${q.year}.`, table: table(holidays, today), view: yearView(q.year) };
      }
    }
  },
};

export const myHolidaysModule: AiModule = {
  key: 'my-holidays',
  title: 'Holidays assistant',
  intro: () => 'Ask about the holiday calendar: the next holiday, a month, a year or long weekends, by typing or speaking.',
  starters: [
    { label: 'Next holiday', toolCall: { name: 'list_holidays', args: { when: 'next holiday' } } },
    { label: 'This year', toolCall: { name: 'list_holidays', args: { when: 'this year' } } },
    { label: 'Long weekends', toolCall: { name: 'list_holidays', args: { when: 'long weekends' } } },
  ],
  systemPrompt: (ctx) => `${basePrompt(ctx, 'holidays')}
You are the Holidays assistant on the user's own Holidays tab. You answer questions about the organization's holiday calendar.
- Call list_holidays for every question, also when the user writes in Hindi or Hinglish.
- Copy the year, the month, the date or the holiday's name exactly as the user said them.
- You can't change the calendar. The organization admin adds holidays.`,
  tools: [listHolidays],
  // Almost every question is read by the server alone (docs section 9.2).
  direct: (message, ctx) => (holidayQuestion(message, ctx.today) || CHANGES.test(norm(message)) ? { name: 'list_holidays', args: {} } : null),
  elsewhere: (message) => otherTab(message, 'holidays'),
};
