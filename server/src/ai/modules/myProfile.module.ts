import { z } from 'zod';
import { basePrompt } from '../prompts/base.prompt';
import { formatDay } from '../dates';
import { grounded, heardText, isBlank, norm, str } from '../text';
import { AiModule, AiResult, AiTool, AiUserError, BirthdayFormValues, IntroductionFormValues, Prepared } from '../types';
import { asksWholeIntroduction, birthDateIn, INTRO_TITLES, introductionIn, IntroKey, otherTab } from './me.helpers';
import { controlWord } from './performance.helpers';

// The Profile assistant on the Me page's Profile tab (docs/AI_ME_ASSISTANTS.md, section 7): the
// job details (answers only: the admin keeps them), the date of birth and the introduction.
// Through /auth/me, /people and /me/* with the user's own token.

interface Person {
  id: string;
  name: string;
  jobTitle: string | null;
  departmentName: string | null;
  reportsTo: string | null;
  joiningDate: string | null;
}

type Introduction = IntroductionFormValues;

const text = (description: string) =>
  z.preprocess((v) => (isBlank(v) ? undefined : typeof v === 'string' ? v : String(v)), z.string().optional()).describe(description);

const INTRO_KEYS: IntroKey[] = ['about', 'hobbies', 'lovesAboutJob'];
const PRIVACY = 'Colleagues see only the day and month, to wish you on your birthday.';
const ask = (result: AiResult, draft: Extract<Prepared, { kind: 'ask' }>['draft'] = null): Prepared => ({ kind: 'ask', result, draft });
const short = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------------------------------------------------------------- my_profile

const profileInput = z.object({ about: text('What the user asked about: "manager", "job title", "department", "joining date", "email", "date of birth" or "introduction"') });

type Focus = 'manager' | 'title' | 'department' | 'joined' | 'email' | 'birthday' | 'introduction' | 'all';

function focusOf(words: string): Focus {
  const t = norm(words);
  if (/\b(?:manager|boss|report to|reports to|reporting manager|lead)\b/.test(t)) return 'manager';
  if (/\b(?:job title|title|designation|position|role)\b/.test(t)) return 'title';
  if (/\b(?:department|dept|team am i in)\b/.test(t)) return 'department';
  if (/\b(?:join(?:ed|ing)?|start(?:ed)? (?:here|working)|joining date|date of joining|how long)\b/.test(t)) return 'joined';
  if (/\b(?:email|e mail|mail id)\b/.test(t)) return 'email';
  if (/\b(?:birthday|date of birth|dob|born)\b/.test(t)) return 'birthday';
  if (/\b(?:introduction|intro|about me|hobbies|hobby|love about my job)\b/.test(t)) return 'introduction';
  return 'all';
}

const myProfile: AiTool<z.infer<typeof profileInput>> = {
  name: 'my_profile',
  label: 'Looking up your profile',
  kind: 'read',
  description: "Answer questions about the user's own profile: manager, job title, department, joining date, email, date of birth and introduction.",
  input: profileInput,
  async run(args, api, ctx) {
    const [auth, all, details, intro] = await Promise.all([
      api.get<{ user: { email: string; name: string } }>('/auth/me'),
      api.get<Person[]>('/people'),
      api.get<{ dateOfBirth: string | null }>('/me/profile-details'),
      api.get<Introduction>('/me/introduction'),
    ]);
    const me = all.find((p) => p.id === ctx.user.id);
    const manager = me?.reportsTo ? all.find((p) => p.id === me.reportsTo) : undefined;
    const managerText = manager ? `**${manager.name}**${manager.jobTitle ? ` (${manager.jobTitle})` : ''}` : null;
    const answered = INTRO_KEYS.filter((k) => intro[k]?.trim());
    const focus = focusOf(ctx.fromButton ? (str(args.about) ?? '') : `${ctx.latestText} ${str(args.about) ?? ''}`);
    switch (focus) {
      case 'manager':
        return { text: managerText ? `You report to ${managerText}.` : "You don't report to anyone yet. Your admin sets your manager." };
      case 'title':
        return { text: me?.jobTitle ? `Your job title is **${me.jobTitle}**.` : "You don't have a job title yet. Your admin sets it." };
      case 'department':
        return { text: me?.departmentName ? `You're in **${me.departmentName}**.` : "You're not in a department yet. Your admin sets it." };
      case 'joined':
        return { text: me?.joiningDate ? `You joined on **${formatDay(me.joiningDate.slice(0, 10))}**.` : "Your joining date isn't set. Your admin sets it." };
      case 'email':
        return { text: `Your email is **${auth.user.email}**.` };
      case 'birthday':
        return {
          text: details.dateOfBirth ? `Your date of birth is **${formatDay(details.dateOfBirth)}**. ${PRIVACY}` : "You haven't set your date of birth. Say, for example, “My date of birth is 24 Oct 1995”.",
        };
      case 'introduction':
        if (!answered.length) return { text: "You haven't written your introduction yet. Say “Write my introduction” and I'll ask the three questions." };
        return {
          text: `Your introduction (${answered.length} of 3 answered):`,
          table: { columns: [{ key: 'part', title: 'Part' }, { key: 'answer', title: 'Answer' }], rows: INTRO_KEYS.map((k) => ({ part: INTRO_TITLES[k], answer: intro[k]?.trim() ? short(intro[k].trim()) : '—' })) },
        };
      default:
        return {
          text: 'Your profile. Your admin keeps the job details up to date; you can change your date of birth and introduction here.',
          table: {
            columns: [{ key: 'label', title: 'Detail' }, { key: 'value', title: 'Value' }],
            rows: [
              { label: 'Name', value: auth.user.name },
              { label: 'Email', value: auth.user.email },
              { label: 'Job title', value: me?.jobTitle || '—' },
              { label: 'Department', value: me?.departmentName || '—' },
              { label: 'Reports to', value: manager?.name ?? '—' },
              { label: 'Date of joining', value: me?.joiningDate ? formatDay(me.joiningDate.slice(0, 10)) : '—' },
              { label: 'Date of birth', value: details.dateOfBirth ? formatDay(details.dateOfBirth) : 'Not set' },
              { label: 'Introduction', value: `${answered.length} of 3 answered` },
            ],
          },
        };
    }
  },
};

// ---------------------------------------------------------------- set_birthday

const birthdayInput = z.object({
  date: text('The date of birth exactly as the user said it'),
  remove: text('"yes" only if the user asked to remove their date of birth'),
});

const birthdaySchema = z.object({ dateOfBirth: z.string().regex(/^(?:\d{4}-\d{2}-\d{2})?$/, 'Choose a date') });

/** The API's rules (dateOfBirthSchema): not in the future, from 1900 on. */
function birthdayProblem(date: string, today: string): string | null {
  if (date > today) return "A date of birth can't be in the future.";
  if (date < '1900-01-01') return 'Enter a date after 1900.';
  return null;
}

const REMOVE = /\b(?:remove|delete|clear|erase|hide|unset)\b/;

const setBirthday: AiTool<z.infer<typeof birthdayInput>> = {
  name: 'set_birthday',
  label: 'Checking the date',
  kind: 'write',
  description: 'Set or remove the user\'s own date of birth. Colleagues see only the day and month. The user confirms first.',
  input: birthdayInput,

  async prepare(args, api, ctx) {
    const current = (await api.get<{ dateOfBirth: string | null }>('/me/profile-details')).dateOfBirth;
    const b = ctx.fromButton;
    const draft = ctx.draft?.tool === 'set_birthday' ? ctx.draft.args : {};
    const remove = b ? str(args.remove) === 'yes' : REMOVE.test(norm(ctx.latestText));
    if (remove) {
      if (!current) return ask({ text: "You haven't set a date of birth, so there's nothing to remove." });
      return {
        kind: 'card',
        card: { title: 'Remove your date of birth?', tone: 'danger', rows: [{ label: 'Date of birth', value: '—', previous: formatDay(current) }], confirmLabel: 'Remove' },
        calls: [{ method: 'PUT', path: '/me/profile-details', body: { dateOfBirth: null } }],
      };
    }
    const said = b
      ? str(args.date) && /^\d{4}-\d{2}-\d{2}$/.test(String(args.date))
        ? { date: String(args.date) }
        : str(draft.monthDay)
          ? { monthDay: String(draft.monthDay) }
          : null
      : (birthDateIn(ctx.latestText) ?? (str(args.date) && grounded(String(args.date), ctx.latestText) ? birthDateIn(String(args.date)) : null));
    const values: BirthdayFormValues = { dateOfBirth: said && 'date' in said ? said.date : '' };
    const form = { kind: 'birthday' as const, mode: 'update' as const, values };
    if (!said || !('date' in said)) {
      if (ctx.form) return { kind: 'card', card: { title: 'Set your date of birth', tone: 'default', rows: [{ label: 'Date of birth', value: current ? formatDay(current) : '—' }], notes: [PRIVACY], confirmLabel: 'Save', form: { ...form, values: { dateOfBirth: current ?? '' } }, incomplete: true }, calls: [] };
      if (said) return ask({ text: 'Which year were you born?' }, { tool: 'set_birthday', args: { monthDay: said.monthDay }, missing: ['year'], notSaved: [] });
      return ask({ text: 'What’s your date of birth? For example “24 Oct 1995”.' }, { tool: 'set_birthday', args: {}, missing: ['date'], notSaved: [] });
    }
    const problem = birthdayProblem(said.date, ctx.today);
    if (problem) return ask({ text: problem });
    if (said.date === current) return ask({ text: `Your date of birth is already **${formatDay(current)}**.` });
    return {
      kind: 'card',
      card: {
        title: 'Set your date of birth',
        tone: 'default',
        rows: [{ label: 'Date of birth', value: formatDay(said.date), ...(current ? { previous: formatDay(current) } : {}) }],
        notes: [PRIVACY],
        confirmLabel: 'Save',
        form,
      },
      calls: [{ method: 'PUT', path: '/me/profile-details', body: { dateOfBirth: said.date } }],
    };
  },

  async fillFromReply(draft, reply) {
    if (draft.tool !== 'set_birthday') return null;
    if (draft.missing.includes('year')) {
      const year = /\b(19\d{2}|20\d{2})\b/.exec(reply)?.[1];
      const date = year ? `${year}-${String(draft.args.monthDay)}` : null;
      // 29 Feb only in a leap year.
      return date && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().startsWith(date) ? { date } : null;
    }
    const said = birthDateIn(reply);
    if (!said) return null;
    return 'date' in said ? { date: said.date } : { monthDay: said.monthDay };
  },

  async revise(_pending, values, _api, ctx) {
    const parsed = birthdaySchema.safeParse(values);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    const date = parsed.data.dateOfBirth || null;
    const problem = date ? birthdayProblem(date, ctx.today) : null;
    if (problem) throw new AiUserError(problem);
    return [{ method: 'PUT', path: '/me/profile-details', body: { dateOfBirth: date } }];
  },

  done([result]) {
    const { dateOfBirth } = result as { dateOfBirth: string | null };
    return { text: dateOfBirth ? `✅ **Date of birth saved:** ${formatDay(dateOfBirth)}.` : '✅ Your date of birth was removed.' };
  },
};

// ---------------------------------------------------------------- update_introduction

const introInput = z.object({
  about: text('The new "About me" answer exactly as the user said it, only if they gave one'),
  hobbies: text('The new hobbies exactly as the user said them, only if they gave them'),
  lovesAboutJob: text('The new "What I love about my job" answer exactly as the user said it, only if they gave one'),
  walk: text('Leave empty'),
});

const introSchema = z.object({ about: z.string().max(1000, 'At most 1,000 characters'), hobbies: z.string().max(1000, 'At most 1,000 characters'), lovesAboutJob: z.string().max(1000, 'At most 1,000 characters') });

/** What the three-question walk keeps between replies (the draft's args). */
interface WalkArgs {
  walk?: boolean | string;
  answers?: Partial<Introduction>;
  skipped?: IntroKey[];
  stop?: boolean;
  finish?: boolean;
}

const QUESTIONS: Record<IntroKey, string> = {
  about: 'Tell your colleagues a little about yourself: where you are from, what you do, a fun fact.',
  hobbies: 'What are your hobbies?',
  lovesAboutJob: 'What do you love about your job?',
};

const updateIntroduction: AiTool<z.infer<typeof introInput>> = {
  name: 'update_introduction',
  label: 'Preparing your introduction',
  kind: 'write',
  description: 'Change the user\'s introduction: "About me", "My hobbies" and "What I love about my job". Colleagues see it on the Welcome tab. The user confirms first.',
  input: introInput,

  async prepare(args, api, ctx) {
    const a = args as z.infer<typeof introInput> & WalkArgs;
    if (a.stop) return ask({ text: 'OK, I stopped. Nothing was saved.' });
    const current = await api.get<Introduction>('/me/introduction');
    const b = ctx.fromButton;
    let changes: Partial<Introduction>;
    if (b || a.walk) {
      changes = { ...(a.answers ?? {}) };
      for (const k of INTRO_KEYS) if (str(a[k]) !== undefined) changes[k] = String(a[k]);
    } else {
      changes = introductionIn(ctx.latestText);
      // The model's copy, for an answer the reader didn't find, when the user really said it.
      for (const k of INTRO_KEYS) if (changes[k] === undefined && str(a[k]) && heardText(String(a[k]), ctx.latestText)) changes[k] = String(a[k]).slice(0, 1000);
    }
    const walk = Boolean(a.walk) || (!b && asksWholeIntroduction(ctx.latestText));
    if (walk && !ctx.form && !a.finish) {
      const skipped = a.skipped ?? [];
      const next = INTRO_KEYS.findIndex((k) => changes[k] === undefined && !skipped.includes(k));
      if (next >= 0) {
        const key = INTRO_KEYS[next];
        const now = current[key]?.trim();
        return ask(
          { text: `**${INTRO_TITLES[key]}** (${next + 1} of 3). ${QUESTIONS[key]}${now ? ` Now: *${short(now).replace(/[.!]+$/, '')}*.` : ''} Say your answer, or “skip” to ${now ? 'keep it' : 'leave it empty'}.` },
          { tool: 'update_introduction', args: { walk: true, answers: changes, skipped } as Record<string, unknown>, missing: [`intro:${key}`], notSaved: [], freeText: true }
        );
      }
    }
    const values: Introduction = { ...current, ...changes };
    const form = { kind: 'introduction' as const, mode: 'update' as const, values };
    const changed = INTRO_KEYS.filter((k) => (changes[k] ?? current[k]) !== current[k]);
    if (!changed.length) {
      if (walk && !ctx.form) return ask({ text: 'Nothing changed: your introduction stays as it was.' });
      if (ctx.form) return { kind: 'card', card: { title: 'Update your introduction', tone: 'default', rows: INTRO_KEYS.map((k) => ({ label: INTRO_TITLES[k], value: current[k] || '—' })), confirmLabel: 'Save', form, incomplete: true }, calls: [], meta: { current } };
      if (Object.keys(changes).length) return ask({ text: "That's already your introduction." });
      return ask({
        text: 'Which part of your introduction? **About me**, **My hobbies** or **What I love about my job**. For example “Set my hobbies to cycling and chess”.',
        buttons: [
          { label: 'Answer all three', toolCall: { name: 'update_introduction', args: { walk: 'yes' } } },
          { label: 'Fill in the form instead', toolCall: { name: 'update_introduction', args: {}, form: true } },
        ],
      });
    }
    return {
      kind: 'card',
      card: {
        title: 'Update your introduction',
        tone: 'default',
        rows: changed.map((k) => ({ label: INTRO_TITLES[k], value: values[k] || '—', previous: current[k] || '—' })),
        notes: ['Colleagues see your introduction on the Welcome tab and your profile.'],
        confirmLabel: 'Save',
        form,
      },
      calls: [{ method: 'PUT', path: '/me/introduction', body: Object.fromEntries(changed.map((k) => [k, values[k].trim()])) }],
      meta: { current },
    };
  },

  async fillFromReply(draft, reply) {
    if (draft.tool !== 'update_introduction') return null;
    const args = draft.args as WalkArgs;
    const key = (draft.missing[0] ?? '').replace(/^intro:/, '') as IntroKey;
    if (!INTRO_KEYS.includes(key)) return null;
    const word = controlWord(reply);
    if (word === 'stop') return { ...args, stop: true };
    if (word === 'done') return { ...args, finish: true };
    if (word === 'skip') return { ...args, skipped: [...(args.skipped ?? []), key] };
    const answer = reply.trim();
    return { ...args, answers: { ...(args.answers ?? {}), [key]: (answer.charAt(0).toUpperCase() + answer.slice(1)).slice(0, 1000) } };
  },

  async revise(pending, values) {
    const parsed = introSchema.safeParse(values);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    const current = pending.meta.current as Introduction;
    const changed = INTRO_KEYS.filter((k) => parsed.data[k].trim() !== (current[k] ?? '').trim());
    if (!changed.length) throw new AiUserError('Nothing has changed.');
    return [{ method: 'PUT', path: '/me/introduction', body: Object.fromEntries(changed.map((k) => [k, parsed.data[k].trim()])) }];
  },

  done() {
    return { text: '✅ **Introduction saved.** Colleagues see it on the Welcome tab and your profile.' };
  },
};

// ---------------------------------------------------------------- what the tab doesn't change (section 7.3)

const ADMIN_KEPT: [RegExp, string][] = [
  [/\b(?:job title|title|designation|position)\b/, 'job title'],
  [/\b(?:department|dept)\b/, 'department'],
  [/\b(?:manager|reporting manager|boss)\b/, 'manager'],
  [/\b(?:joining date|date of joining|join date)\b/, 'joining date'],
  [/\b(?:email|e mail|mail id)\b/, 'email'],
];

/** A change the Profile tab can't make, and where it's made instead. Null when it's this tab's. */
export function profileNotHere(message: string): string | null {
  const t = norm(message);
  // An introduction answer may mention anything ("About me: I manage the design department").
  if (Object.keys(introductionIn(message)).length) return null;
  if (/\bpassword\b/.test(t)) return 'Your password is changed on **Change password**. Say “Go to change password” to open it.';
  const changes = /\b(?:change|update|edit|set|correct|fix|modify|upload|remove)\b/.test(t);
  if (!changes) return null;
  if (/\b(?:photo|picture|pic|avatar|my name|display name)\b/.test(t)) return 'Your photo and name are changed on **My profile** (the menu under your name, top right). Say “Go to my profile” to open it.';
  const kept = ADMIN_KEPT.find(([re]) => re.test(t));
  return kept ? `Your organization admin keeps your **${kept[1]}** up to date. Ask them to change it.` : null;
}

// ---------------------------------------------------------------- module

function direct(message: string): { name: string; args: Record<string, unknown> } | null {
  const t = norm(message);
  if (/^(?:who|whom) (?:is|s) my (?:manager|boss|reporting manager)$|^who do i report to$|^what (?:is|s) my (?:job title|designation|department|email)$|^when did i join$|^(?:show )?my (?:profile|details)$/.test(t)) return { name: 'my_profile', args: {} };
  if (asksWholeIntroduction(message)) return { name: 'update_introduction', args: { walk: 'yes' } };
  return null;
}

export const myProfileModule: AiModule = {
  key: 'my-profile',
  title: 'Profile assistant',
  intro: () => 'See your job details, and set your date of birth and introduction, by typing or speaking. Nothing is saved until you Confirm.',
  starters: [
    { label: 'My profile', toolCall: { name: 'my_profile', args: {} } },
    { label: 'Edit introduction', toolCall: { name: 'update_introduction', args: {}, form: true } },
    { label: 'Set date of birth', toolCall: { name: 'set_birthday', args: {}, form: true } },
  ],
  systemPrompt: (ctx) => `${basePrompt(ctx, 'your profile')}
You are the Profile assistant on the user's own Profile tab. You help them see their job details, set their date of birth, and write their introduction (about me, hobbies, what they love about their job).
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- Questions about their manager, job title, department, joining date or email: call my_profile.
- Date of birth: call set_birthday with the date exactly as the user said it.
- Introduction: call update_introduction with each answer exactly as the user said it. Leave out the ones they didn't mention.
- Never make up an answer or a date.
- The job title, department, manager, joining date and email are kept by the organization admin. Say so if asked to change them.
- Never say that something was saved. The app shows that after the backend confirms it.`,
  tools: [myProfile, setBirthday, updateIntroduction],
  direct,
  elsewhere: (message) => profileNotHere(message) ?? otherTab(message, 'profile'),
  shows: ['profile'],
};
