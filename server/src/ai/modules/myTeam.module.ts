import { z } from 'zod';
import { basePrompt } from '../prompts/base.prompt';
import { dayOf, formatDay } from '../dates';
import { grounded, isBlank, mentions, str } from '../text';
import { AiModule, AiTool } from '../types';
import { otherTab, rangeText, teamFocus } from './me.helpers';

// The Team assistant on the Me page's Team tab (docs/AI_ME_ASSISTANTS.md, section 8): the user's
// manager, teammates and direct reports, and who is on approved leave today or this week. Answers
// only, from GET /me/team, as the tab is read-only.

interface Member {
  id: string;
  name: string;
  jobTitle: string | null;
  departmentName: string | null;
  leaveToday: { halfDay: 'first' | 'second' | null } | null;
  /** Working dates this week (Mon–Sun) on approved leave. */
  leaveThisWeek: string[];
}

interface MyTeam {
  today: string;
  week: { from: string; to: string };
  manager: Member | null;
  peers: Member[];
  directReports: Member[];
}

const text = (description: string) =>
  z.preprocess((v) => (isBlank(v) ? undefined : typeof v === 'string' ? v : String(v)), z.string().optional()).describe(description);

const firstName = (name: string) => name.split(/\s+/)[0];
const dayShort = (iso: string) => formatDay(iso).replace(/ \d{4}$/, '');
const half = (m: Member) => (m.leaveToday?.halfDay ? ` (${m.leaveToday.halfDay} half)` : '');
const details = (m: Member) => [m.jobTitle, m.departmentName].filter(Boolean).join(' · ');
const DAY_WORDS = /\b(?:today|tomorrow|yesterday|tonight|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*|next week)\b/i;

/** The days a member is away this week, today first: "today, first half", "Fri 23 Oct". */
function awayDays(m: Member, today: string): string[] {
  const days = [...new Set([...(m.leaveToday ? [today] : []), ...m.leaveThisWeek])].sort();
  return days.map((d) => (d === today ? `today${m.leaveToday?.halfDay ? `, ${m.leaveToday.halfDay} half` : ''}` : dayShort(d)));
}

function availability(m: Member, today: string): string {
  if (m.leaveToday) return `On leave today${half(m)}`;
  const away = awayDays(m, today);
  return away.length ? `On leave ${away.join(', ')}` : 'Available this week';
}

const teamInput = z.object({
  who: text('"manager", "teammates", "reports", "on leave" or "everyone", as the user asked'),
  person: text("A person's name, exactly as the user said it, only if they asked about someone"),
  day: text('The day exactly as the user said it, only if they named one'),
});

const myTeam: AiTool<z.infer<typeof teamInput>> = {
  name: 'my_team',
  label: 'Looking up your team',
  kind: 'read',
  description: "Answer questions about the user's team: their manager, teammates (same manager), direct reports, and who is on leave today or this week.",
  input: teamInput,
  async run(args, api, ctx) {
    const team = await api.get<MyTeam>('/me/team');
    const today = team.today ?? ctx.today;
    const manager = team.manager;
    const members: { m: Member; as: string }[] = [
      ...(manager ? [{ m: manager, as: 'Manager' }] : []),
      ...team.peers.map((m) => ({ m, as: 'Teammate' })),
      ...team.directReports.map((m) => ({ m, as: 'Reports to you' })),
    ];
    if (!members.length) return { text: "You're not in a team yet. Ask your admin to set your manager." };

    const said = ctx.fromButton ? `${str(args.who) ?? ''} ${str(args.person) ?? ''} ${str(args.day) ?? ''}` : ctx.latestText;
    const modelPerson = !ctx.fromButton && str(args.person) && grounded(String(args.person), ctx.latestText) ? String(args.person) : undefined;
    const named = members.filter(({ m }) => mentions(said, m.name));
    const byFirst = named.length ? named : members.filter(({ m }) => mentions(said, firstName(m.name)) || (modelPerson ? mentions(modelPerson, firstName(m.name)) : false));
    const person = byFirst.length === 1 ? byFirst[0] : null;
    const focus = teamFocus(said) ?? (person ? 'available' : 'all');
    const dayWords = DAY_WORDS.exec(said)?.[0];
    const day = dayWords && !/^today$/i.test(dayWords) ? dayOf(said, today, 'future') : null;
    const inWeek = (d: string) => d >= team.week.from && d <= team.week.to;
    const weekText = rangeText(team.week.from, team.week.to);

    if (focus === 'wfh') return { text: 'The Team tab shows leave only, not work from home.' };
    if (byFirst.length > 1 && !person) {
      return { text: `Which one? ${byFirst.map(({ m }) => `**${m.name}** (${availability(m, today)})`).join(', ')}.` };
    }

    // Someone named who isn't in the team: "Is Mike in my team?"
    const asked = modelPerson ?? /\b(?:[Ii]s|[Ww]as|[Dd]oes|[Hh]as|[Ww]ill|[Cc]an)\s+([A-Z][\p{L}'-]+)/u.exec(ctx.fromButton ? '' : ctx.latestText)?.[1];
    if (!person && asked && !/^(?:my|anyone|anybody|everyone|someone|there|it|he|she|they|the|this|that|today|tomorrow|yesterday|(?:mon|tues|wednes|thurs|fri|satur|sun)day|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/i.test(asked)) {
      return { text: `**${asked}** isn't in your team. Your team is your manager, the people who share your manager, and the people who report to you.` };
    }

    if (person && focus !== 'manager' && focus !== 'reports' && focus !== 'peers') {
      const { m } = person;
      if (day) {
        if (!inWeek(day)) return { text: `I can only see leave for this week (${weekText}). Ask ${firstName(m.name)}${manager && manager.id !== m.id ? `, or ${manager.name}` : ''}.` };
        const away = m.leaveThisWeek.includes(day) || (day === today && Boolean(m.leaveToday));
        return { text: away ? `**${m.name}** is on leave on ${formatDay(day)}${day === today ? half(m) : ''}.` : `**${m.name}** has no leave on ${formatDay(day)}.` };
      }
      return { text: `**${m.name}** (${person.as.toLowerCase()}${details(m) ? `, ${details(m)}` : ''}): ${availability(m, today).toLowerCase()}.` };
    }

    switch (focus) {
      case 'manager':
        return { text: manager ? `Your manager is **${manager.name}**${details(manager) ? ` (${details(manager)})` : ''}. ${availability(manager, today)}.` : "You don't have a manager set. Ask your admin to set one." };
      case 'reports': {
        const reports = team.directReports;
        if (!reports.length) return { text: 'No one reports to you.' };
        return { text: `**${reports.length} ${reports.length === 1 ? 'person' : 'people'}** ${reports.length === 1 ? 'reports' : 'report'} to you: ${reports.map((m) => `${m.name}${m.jobTitle ? ` (${m.jobTitle})` : ''}`).join(', ')}.` };
      }
      case 'peers':
        if (!team.peers.length) return { text: manager ? `No one else reports to ${manager.name}.` : "You have no teammates yet: teammates are the people who share your manager, and you don't have one set." };
        return { text: `Your teammates${manager ? ` (they also report to ${manager.name})` : ''}: ${team.peers.map((m) => m.name).join(', ')}.` };
      case 'leave':
      case 'available': {
        if (day && day !== today) {
          if (!inWeek(day)) return { text: `I can only see leave for this week (${weekText}).` };
          const away = members.filter(({ m }) => m.leaveThisWeek.includes(day));
          return { text: away.length ? `On leave on ${formatDay(day)}: ${away.map(({ m }) => `**${m.name}**`).join(', ')}.` : `No one in your team is on leave on ${formatDay(day)}.` };
        }
        if (/\bweek\b/i.test(said)) {
          const away = members.filter(({ m }) => awayDays(m, today).length);
          return { text: away.length ? `On leave this week: ${away.map(({ m }) => `**${m.name}** (${awayDays(m, today).join('; ')})`).join(', ')}.` : 'No one in your team is on leave this week.' };
        }
        const away = members.filter(({ m }) => m.leaveToday);
        if (!away.length) return { text: 'No one in your team is on leave today.' };
        if (away.length === 1) return { text: `**${away[0].m.name}** is on leave today${half(away[0].m)}.` };
        return { text: `On leave today: ${away.map(({ m }) => `**${m.name}**${half(m)}`).join(', ')}.` };
      }
      default:
        return {
          text: `Your team: **${members.length} ${members.length === 1 ? 'person' : 'people'}**.`,
          table: {
            columns: [
              { key: 'name', title: 'Name' },
              { key: 'as', title: 'In your team as' },
              { key: 'title', title: 'Job title' },
              { key: 'department', title: 'Department' },
              { key: 'week', title: 'This week' },
            ],
            rows: members.map(({ m, as }) => ({ name: m.name, as, title: m.jobTitle || '—', department: m.departmentName || '—', week: availability(m, today) })),
          },
        };
    }
  },
};

export const myTeamModule: AiModule = {
  key: 'my-team',
  title: 'Team assistant',
  intro: () => 'Ask about your manager, teammates and reports, and who is on leave, by typing or speaking.',
  starters: [
    { label: 'My team', toolCall: { name: 'my_team', args: { who: 'everyone' } } },
    { label: 'On leave today', toolCall: { name: 'my_team', args: { who: 'on leave today' } } },
    { label: 'On leave this week', toolCall: { name: 'my_team', args: { who: 'on leave this week' } } },
  ],
  systemPrompt: (ctx) => `${basePrompt(ctx, 'your team')}
You are the Team assistant on the user's own Team tab. You answer questions about their manager, their teammates (people with the same manager), the people who report to them, and who is on leave today or this week.
- Call my_team for every question, also when the user writes in Hindi or Hinglish.
- Copy the person's name and the day exactly as the user said them.
- You can't change anything here. The organization admin sets who reports to whom.`,
  tools: [myTeam],
  // Almost every question is read by the server alone (docs section 8.2).
  direct: (message) => (teamFocus(message) ? { name: 'my_team', args: {} } : null),
  elsewhere: (message) => otherTab(message, 'team'),
};
