import { z } from 'zod';
import { IRole } from '../../models/role.model';
import { roleRepository } from '../../repositories/role.repository';
import { basePrompt } from '../prompts/base.prompt';
import { isBlank, str } from '../text';
import { AiButton, AiModule, AiResult, AiTool, ToolContext } from '../types';
import { AppPage, asksToGo, choosePage, Denial, heardPage, longest, PageMatch, PageRequest, pageByKey, pageDenied, PAGES, pagesIn, readPageRequest, samePage, samePlace } from './navigation.helpers';

// Navigation (docs/AI_NAVIGATION_ASSISTANT.md): "Go to projects", "Jump to dashboard", "Where are
// leave types?" on every assistant, and the Navigation assistant on pages without one of their own.
// It only ever opens pages this user may open, with the rules of the client's route guards.

export const NAVIGATION_KEY = 'navigation';

const bold = (page: AppPage) => `**${page.title}**`;
const openButton = (page: AppPage): AiButton => ({ label: `Open ${page.title}`, toolCall: { name: 'go_to_page', args: { page: page.key } } });
const plain = (text: string) => text.replace(/\*\*/g, '');
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Who may open which page, for this turn. The role's rights are loaded once, and only when needed. */
async function accessFor(ctx: ToolContext): Promise<(page: AppPage) => Denial | null> {
  let role: IRole | null = null;
  if (ctx.user.role === 'ORG_USER' && ctx.user.roleId) role = await roleRepository.findById(ctx.user.roleId);
  return (page) => pageDenied(page, ctx.user, ctx.subscription, role);
}

function refusal(page: AppPage, denial: Denial, ctx: ToolContext, canOpen: (page: AppPage) => boolean, alternatives: AppPage[] = []): AiResult {
  const isAdmin = ctx.user.role === 'ORG_ADMIN';
  const billing = pageByKey('billing')!;
  const lines: Record<Denial, string> = {
    never: page.never ?? '',
    'super-admin': `${bold(page)} is only for the platform's super admin, so I can't open it.`,
    'org-admin': `${bold(page)} is only for your organization's admin, so I can't open it.`,
    permission: `Your role doesn't include ${bold(page)}, so I can't open it. Your admin can give you access.`,
    plan: `Your organization's plan doesn't include ${bold(page)}.${isAdmin ? ' You can change the plan on **Billing & plan**.' : ''}`,
  };
  const text = [lines[denial]];
  const offers = [...alternatives];
  const instead = page.instead ? pageByKey(page.instead.key) : undefined;
  if (instead && canOpen(instead)) {
    text.push(page.instead!.text);
    offers.push(instead);
  }
  if (denial === 'plan' && isAdmin && canOpen(billing)) offers.push(billing);
  const buttons = [...new Map(offers.map((p) => [p.key, p])).values()].map(openButton);
  return { text: text.join(' '), buttons: buttons.length ? buttons : undefined };
}

/** The pages this user may open, with a button for each main one. */
function pageList(canOpen: (page: AppPage) => boolean): AiResult {
  const open = PAGES.filter((p) => !p.never && canOpen(p));
  return {
    text: 'You can open these pages. Say “Go to” and the page, or click one:',
    table: { columns: [{ key: 'page', title: 'Page' }, { key: 'where', title: 'Where' }], rows: open.map((p) => ({ page: p.title, where: capitalized(plain(p.place)) })) },
    buttons: open.filter((p) => p.main).map((p) => ({ label: p.title, toolCall: { name: 'go_to_page', args: { page: p.key } } })),
  };
}

/**
 * The answer to a page request (docs section 6), or null when it isn't one after all: a "show" of
 * this page's own data ("Show projects" on Projects), or of a page the user may not open, is the
 * module's work, and so is "Open project Apollo" on Projects.
 */
export async function pageAnswer(request: PageRequest, ctx: ToolContext): Promise<AiResult | null> {
  const denied = await accessFor(ctx);
  const canOpen = (page: AppPage) => !denied(page);
  const here = ctx.page;
  if (request.kind === 'list') return pageList(canOpen);

  if (request.kind === 'two') {
    const pages = [request.first, request.second].map((m) => choosePage(m, canOpen)).flatMap((c) => (c.kind === 'one' ? [c.page] : c.kind === 'many' ? c.pages : []));
    if (!pages.length) {
      const closed = choosePage(request.first, canOpen) as Extract<ReturnType<typeof choosePage>, { kind: 'closed' }>;
      return refusal(closed.page, denied(closed.page)!, ctx, canOpen);
    }
    return { text: 'I can open one page at a time. Which one?', buttons: pages.map(openButton) };
  }

  const choice = choosePage(request.matches, canOpen);
  if (request.kind === 'show') {
    const top = request.matches.filter((m) => m.length === Math.max(...request.matches.map((x) => x.length)));
    if (choice.kind !== 'one' || top.some((m) => samePage(m.page.path, here))) return null;
  }
  if (request.kind === 'more' && choice.kind === 'one' && samePage(choice.page.path, here)) return null;

  if (choice.kind === 'closed') return refusal(choice.page, denied(choice.page)!, ctx, canOpen, choice.others);
  if (choice.kind === 'many') return { text: 'Which page did you mean?', buttons: choice.pages.map(openButton) };
  const page = choice.page;
  // A page the model picked that the user's words don't name ("Open payroll" → Expenses): a suggestion, never a jump.
  if (request.kind !== 'more' && request.model && !heardPage(page, ctx.latestText)) {
    return { text: `I think you mean ${bold(page)}, ${page.place}.`, buttons: [openButton(page)] };
  }
  if (request.kind === 'where') {
    if (samePlace(page.path, here)) return { text: `You're on ${bold(page)} now.` };
    return { text: `${bold(page)} is ${page.place}.`, buttons: [openButton(page)] };
  }
  if (request.kind === 'more') return { text: `I can open ${bold(page)} first. Then ask there: “${request.rest}”.`, buttons: [openButton(page)] };
  if (samePlace(page.path, here)) return { text: `You're already on ${bold(page)}.` };
  return { text: `Opening ${bold(page)}.`, goTo: page.path };
}

/**
 * The shared step of every turn (agent.service `runTurn`, step 1b): a message that asks for a
 * page, answered with no model call. `bare`: a page name alone counts too (the Navigation assistant).
 */
export async function pageTurn(message: string, ctx: ToolContext, opts: { bare?: boolean } = {}): Promise<AiResult | null> {
  const request = readPageRequest(message, opts);
  return request ? pageAnswer(request, ctx) : null;
}

const goToInput = z.object({
  page: z.preprocess((v) => (isBlank(v) ? undefined : typeof v === 'string' ? v : String(v)), z.string().optional()).describe("The page the user wants, in their own words ('projects', 'my leave', 'leave types')"),
});

const goToPage: AiTool<z.infer<typeof goToInput>> = {
  name: 'go_to_page',
  label: 'Finding the page',
  kind: 'read',
  description: 'Open a page of the app for the user: Home, the Me tabs, Approvals, Expenses, Employees, Projects, Tasks and the others.',
  input: goToInput,
  async run(args, _api, ctx) {
    const asked = str(args.page) ?? '';
    // A button (or chip) names the page by its key. Access is checked again all the same (pageAnswer).
    const byKey = ctx.fromButton ? pageByKey(asked) : undefined;
    if (byKey) return (await pageAnswer({ kind: 'go', matches: [{ page: byKey, length: 1, plain: false, start: 0, end: 0 }] }, ctx))!;
    // The user's own words when they name a page more closely than the model's copy ("approve some
    // claims" over the model's "Approvals"), else the model's.
    const said = pagesIn(ctx.latestText);
    const copied = pagesIn(asked);
    const matches: PageMatch[] = longest(said) > longest(copied) ? said : copied;
    if (!matches.length) return { text: `I couldn't find a page called “${asked || ctx.latestText}”. Say “Where can I go?” to see the pages you can open.` };
    // It jumps only when the user asked to go somewhere; otherwise it's a "where", with a button.
    return (await pageAnswer({ kind: asksToGo(ctx.latestText) ? 'go' : 'where', matches, model: true }, ctx))!;
  },
};

const listPages: AiTool<Record<string, unknown>> = {
  name: 'list_pages',
  label: 'Listing your pages',
  kind: 'read',
  description: 'List the pages of the app this user may open.',
  input: z.object({}).passthrough(),
  async run(_args, _api, ctx) {
    return (await pageAnswer({ kind: 'list' }, ctx))!;
  },
};

/** Run from a button on any assistant: "Open Projects" after "Where are projects?". */
export const PAGE_TOOLS: AiTool[] = [goToPage as AiTool, listPages];

const titlesFor = (role: ToolContext['user']['role']) =>
  PAGES.filter((p) => !p.never && p.roles.includes(role))
    .map((p) => p.title)
    .join(', ');

export const navigationModule: AiModule = {
  key: NAVIGATION_KEY,
  title: 'Navigation assistant',
  intro: () => 'Say where you want to go, for example “Go to projects” or “Open my leave”.',
  starters: [
    { label: 'Where can I go?', toolCall: { name: 'list_pages', args: {} } },
    { label: 'My leave', toolCall: { name: 'go_to_page', args: { page: 'me-leave' } } },
    { label: 'My attendance', toolCall: { name: 'go_to_page', args: { page: 'me-attendance' } } },
  ],
  systemPrompt: (ctx) => `${basePrompt(ctx, 'moving between pages')}
You are the Navigation assistant. You open pages of the app for the user.
- When the user wants to go to, open or see a page, call go_to_page with the page in the user's own words.
- When the user asks which pages there are or where they can go, call list_pages.
- Only go_to_page opens a page. Never say you opened one yourself.
- For anything else, say that each page's own assistant does the work there.
Pages: ${titlesFor(ctx.role)}.`,
  tools: PAGE_TOOLS,
};
