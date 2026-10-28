import { Types } from 'mongoose';
import { env } from '../config/env';
import { AiConversationModel, IAiConversation, IAiMessage, IAiPendingAction } from '../models/aiConversation.model';
import { AuthenticatedUser } from '../types/express';
import { ApiError } from '../utils/apiResponse';
import { todayIso } from '../utils/dates';
import { ApiCallError, createApiClient, takeSecrets } from './apiClient';
import { weekdayOf } from './dates';
import { ModelClient, ModelMessage, ModelUnavailableError, ollamaClient } from './ollama.client';
import { modelQueue } from './queue';
import { smallTalkReply } from './smallTalk';
import { SubscriptionState } from '../services/subscription.service';
import { moduleHome } from './modules/navigation.helpers';
import { NAVIGATION_KEY, PAGE_TOOLS, pageTurn } from './modules/navigation.module';
import { allowedTools, canUseModule, getModule, modelToolsFor } from './registry';
import { AiModule, AiResult, AiTool, AiUserError, ApiClient, ConfirmCard, PendingActionView, ToolCallRef, ToolContext, UploadedFile } from './types';

// One chat turn (docs/AI_ASSISTANT_PLAN.md, 7.6): at most a few model calls, then a tool.
// Reads answer straight away; writes stop at a confirm card. Nothing changes without a click.

const HISTORY_MESSAGES = 8;
const STORED_MESSAGES = 100;
const ACTION_TTL_MS = 10 * 60 * 1000;

export type AiEvent =
  | { type: 'status'; state: 'queued' | 'thinking'; ahead?: number }
  | { type: 'tool'; name: string; label: string }
  | { type: 'token'; text: string }
  | { type: 'message'; message: ChatMessageView }
  | { type: 'done'; conversationId: string }
  | { type: 'error'; message: string; code?: string };

export interface ActionView {
  id: string;
  tool: string;
  card: ConfirmCard;
  status: IAiPendingAction['status'];
  resultText: string | null;
}

/** A message as the chat shows it. */
export interface ChatMessageView {
  role: 'user' | 'assistant';
  text: string;
  result: AiResult | null;
  action: ActionView | null;
  createdAt: string;
}

export interface TurnInput {
  module: AiModule;
  user: AuthenticatedUser;
  token: string;
  conversationId?: string;
  message?: string;
  toolCall?: ToolCallRef & { label?: string };
  /** The page the drawer is on ("/expenses?tab=summary"), for navigation. */
  page?: string;
  subscription?: SubscriptionState;
  emit: (event: AiEvent) => void;
  signal: AbortSignal;
  /** Tests swap these for a scripted model and a fake API. */
  model?: ModelClient;
  api?: ApiClient;
}

const plain = (text: string) => text.replace(/\*\*/g, '');

/**
 * Small models sometimes write the tool call as JSON text instead of a real tool call
 * ({"name": "update_employee", "parameters": {...}}). Returns the call, 'malformed' for
 * broken JSON of that shape, or null for an ordinary text answer.
 */
/** The first balanced {...} at the start of `text` (quotes respected), or null if it never closes. */
function leadingObject(text: string): string | null {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(0, i + 1);
  }
  return null;
}

/** A text answer that says something was done ("Rahul has been added", "kar diya"). Only a confirmed card may say that. */
export function claimsChange(text: string): boolean {
  return /\b(created|added|updated|changed|moved|removed|deleted|disabled|enabled|saved|approved|rejected|applied|downloaded|exported)\b|kiya gaya|kar diya|kar di|ho gaya|ho gayi/i.test(text);
}

const NOTHING_CHANGED = "I didn't change anything: changes only happen after you click Confirm on a card. Could you say that another way?";
// Only an answer that carries files downloads anything.
const NOTHING_DOWNLOADED = 'Nothing was downloaded yet. Say which data you want, for example "Download employees and projects".';
const untrusted = (text: string) => (/\b(downloaded|exported)\b/i.test(text) ? NOTHING_DOWNLOADED : NOTHING_CHANGED);

export function toolCallFromText(content: string): { name: string; args: Record<string, unknown> } | 'malformed' | null {
  const text = content.trim().replace(/^```(?:json)?\s*/, '');
  if (!text.startsWith('{') || !/"name"/.test(text)) return null;
  // llama3.2 through Ollama writes `"parameters{"…` (the `":` lost) and then keeps going
  // with an invented reply: take the first {...} only, and put the `":` back. It also drops a
  // key's opening quote (`"",members":"…"`): a word right after `,` or `{` and before `":` is a key.
  const fixed = text.replace(/"(parameters|arguments)\{/g, '"$1":{').replace(/([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)"\s*:/g, '$1"$2":');
  const json = leadingObject(fixed);
  const parsed = json ? (parseLoose(json) as { name?: unknown; function?: { name?: unknown }; parameters?: unknown; arguments?: unknown } | null) : null;
  if (parsed && typeof parsed === 'object') {
    const name = typeof parsed.name === 'string' ? parsed.name : typeof parsed.function?.name === 'string' ? parsed.function.name : null;
    const args = parsed.parameters ?? parsed.arguments ?? {};
    if (!name) return 'malformed';
    return { name, args: args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {} };
  }
  // The outer object sometimes never closes (`{"name":"list_tasks","parameters{"due":"",} assistant …`):
  // take the name and the parameters object on their own.
  const name = /"name"\s*:\s*"([A-Za-z_][A-Za-z0-9_]*)"/.exec(fixed)?.[1];
  const at = fixed.search(/"(?:parameters|arguments)"\s*:\s*\{/);
  if (name && at >= 0) {
    const inner = leadingObject(fixed.slice(fixed.indexOf('{', at)));
    const args = inner ? parseLoose(inner) : null;
    if (args && typeof args === 'object' && !Array.isArray(args)) return { name, args: args as Record<string, unknown> };
  }
  return 'malformed';
}

/** JSON.parse, forgiving the trailing commas llama3.2 leaves (`{"due":"",}`); null when it still fails. */
function parseLoose(text: string): unknown {
  try {
    return JSON.parse(text.replace(/,\s*([}\]])/g, '$1'));
  } catch {
    return null;
  }
}

/** What the model later reads about an answer: the text, plus the first rows of any table. */
function summaryForModel(result: AiResult): string {
  const rows = result.table?.rows.slice(0, 10).map((r) => Object.values(r).slice(0, 3).join(', '));
  return [plain(result.text), rows?.length ? `Rows: ${rows.join('; ')}` : '', result.warnings?.length ? plain(result.warnings.join(' ')) : '']
    .filter(Boolean)
    .join('\n');
}

function expireStale(conversation: IAiConversation, now = new Date()): void {
  for (const action of conversation.pendingActions) {
    if (action.status === 'pending' && action.expiresAt < now) action.status = 'expired';
  }
}

function actionView(action: IAiPendingAction): ActionView {
  return { id: String(action._id), tool: action.tool, card: action.card, status: action.status, resultText: action.resultText };
}

export function messageView(conversation: IAiConversation, m: IAiMessage): ChatMessageView {
  const action = m.actionId ? conversation.pendingActions.id(m.actionId) : null;
  return {
    role: m.role,
    text: m.role === 'user' ? m.content : '',
    result: m.result,
    action: action ? actionView(action) : null,
    createdAt: new Date(m.createdAt).toISOString(),
  };
}

/**
 * `{0.id}`, `{1.items.newest.id}`: a value an earlier call of this Confirm returned. In a list,
 * `-1` is the last item and `newest` the one with the highest id (ids grow over time; a claim's
 * expenses are sorted by date, so the one just added isn't always last).
 */
export function fillPath(path: string, results: unknown[]): string {
  return path.replace(/\{(\d+)((?:\.[\w-]+)+)\}/g, (_whole, index: string, keys: string) => {
    let value: unknown = results[Number(index)];
    for (const key of keys.slice(1).split('.')) {
      if (Array.isArray(value) && key === 'newest') value = [...value].sort((a, b) => String((a as { id?: string }).id ?? '').localeCompare(String((b as { id?: string }).id ?? ''))).pop();
      else if (Array.isArray(value)) value = value[key === '-1' ? value.length - 1 : Number(key)];
      else value = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
    }
    if (typeof value !== 'string' && typeof value !== 'number') throw new AiUserError('An earlier step returned nothing to continue with.');
    return encodeURIComponent(String(value));
  });
}

function pendingView(action: IAiPendingAction): PendingActionView {
  return { tool: action.tool, args: action.args ?? {}, calls: action.calls ?? [], meta: action.meta ?? {} };
}

async function loadConversation(user: AuthenticatedUser, moduleKey: string, id?: string): Promise<IAiConversation> {
  const owner = { organizationId: new Types.ObjectId(user.organizationId!), userId: new Types.ObjectId(user.id) };
  const existing = id && Types.ObjectId.isValid(id) ? await AiConversationModel.findOne({ _id: id, ...owner, module: moduleKey }) : null;
  return existing ?? new AiConversationModel({ ...owner, module: moduleKey });
}

function toolContext(
  conversation: IAiConversation,
  user: AuthenticatedUser,
  latestText: string,
  opts: { form: boolean; fromButton: boolean; page?: string; subscription?: SubscriptionState }
): ToolContext {
  const said = conversation.messages.filter((m) => m.role === 'user').slice(-20).map((m) => m.content);
  return { user, today: todayIso(), userText: said.join('\n'), latestText, draft: conversation.draft ?? null, ...opts };
}

function addMessage(conversation: IAiConversation, message: Partial<IAiMessage> & Pick<IAiMessage, 'role'>): IAiMessage {
  conversation.messages.push({ content: '', result: null, actionId: null, createdAt: new Date(), ...message });
  if (conversation.messages.length > STORED_MESSAGES) conversation.messages.splice(0, conversation.messages.length - STORED_MESSAGES);
  return conversation.messages[conversation.messages.length - 1];
}

function setDraft(conversation: IAiConversation, draft: IAiConversation['draft']): void {
  conversation.draft = draft;
  conversation.markModified('draft');
}

export async function runTurn(input: TurnInput): Promise<void> {
  const { module, user, emit, signal } = input;
  const model = input.model ?? ollamaClient;
  const api = input.api ?? createApiClient(input.token);
  const tools = await allowedTools(module, user);
  // The module's own tools, and the page tools every assistant's buttons may run ("Open Projects").
  const toolNamed = (name: string) => tools.find((t) => t.name === name) ?? PAGE_TOOLS.find((t) => t.name === name);
  const conversation = await loadConversation(user, module.key, input.conversationId);
  expireStale(conversation);

  const latestText = input.message?.trim() ?? '';
  const history = conversation.messages.slice(-HISTORY_MESSAGES);
  addMessage(conversation, { role: 'user', content: latestText || input.toolCall?.label || input.toolCall?.name || '' });
  const ctx = toolContext(conversation, user, latestText, {
    form: Boolean(input.toolCall?.form),
    fromButton: Boolean(input.toolCall),
    page: input.page ?? moduleHome(module.key),
    subscription: input.subscription,
  });

  const answer = (result: AiResult) => {
    const saved = addMessage(conversation, { role: 'assistant', content: summaryForModel(result), result });
    emit({ type: 'message', message: messageView(conversation, saved) });
  };

  /**
   * Runs one tool. Returns the data to give back to the model, or null when the turn is answered.
   * `final`: no model is involved (a chip, a button, a message the module read itself).
   */
  const dispatch = async (tool: AiTool, args: Record<string, unknown>, final = Boolean(input.toolCall), context = ctx): Promise<string | null> => {
    emit({ type: 'tool', name: tool.name, label: tool.label });
    if (tool.kind === 'read') {
      const result = await tool.run!(args, api, context);
      // An answer with files, or one the page follows or opens, always goes to the user as is: model text can't carry them.
      if (env.AI_FAST_READS || final || result.downloads?.length || result.view || result.goTo) {
        answer(result);
        return null;
      }
      return summaryForModel(result);
    }
    const prepared = await tool.prepare!(args, api, context);
    if (prepared.kind === 'reroute') {
      // Only to a tool this user may use, and only once: a second reroute is treated as a refusal.
      const other = tools.find((t) => t.name === prepared.tool);
      if (!other || !other.prepare || tool.name === prepared.tool || context.rerouted) throw new AiUserError('That action is not available to you.');
      return dispatch(other, prepared.args, final, { ...context, rerouted: true });
    }
    if (prepared.kind === 'ask') {
      setDraft(conversation, prepared.draft ?? null);
      answer(prepared.result);
      return null;
    }
    setDraft(conversation, null);
    conversation.pendingActions.push({
      tool: tool.name,
      args,
      calls: prepared.calls,
      card: prepared.card,
      meta: prepared.meta ?? {},
      status: 'pending',
      expiresAt: new Date(Date.now() + ACTION_TTL_MS),
      resultText: null,
    });
    const action = conversation.pendingActions[conversation.pendingActions.length - 1];
    const saved = addMessage(conversation, {
      role: 'assistant',
      content: `Showed a confirmation card "${prepared.card.title}". Nothing is saved until the user clicks ${prepared.card.confirmLabel}.`,
      actionId: action._id,
    });
    emit({ type: 'message', message: messageView(conversation, saved) });
    return null;
  };

  try {
    // 1. A chip or button names the tool itself: no model call at all.
    if (input.toolCall) {
      const tool = toolNamed(input.toolCall.name);
      if (!tool) throw new AiUserError('That action is not available to you.');
      const parsed = tool.input.safeParse(input.toolCall.args ?? {});
      if (!parsed.success) throw new AiUserError('That request was not valid.');
      await dispatch(tool, parsed.data as Record<string, unknown>);
      return;
    }

    // 1b. "Go to projects", "Jump to dashboard", "Where are leave types?": on every assistant, with
    //     no model call, and only to pages this user may open (docs/AI_NAVIGATION_ASSISTANT.md).
    //     First, so "Hey, take me to my leave" isn't taken for a greeting, nor a draft's reply.
    const toPage = await pageTurn(latestText, ctx, { bare: module.key === NAVIGATION_KEY });
    if (toPage) {
      answer(toPage);
      return;
    }

    // 2. Thanks, greetings and goodbyes: a reply of their own, never a tool (a "thank you" once
    //    repeated the last download). A draft waiting for details is kept for the next message.
    const chitChat = smallTalkReply(latestText);
    if (chitChat) {
      answer({ text: chitChat });
      return;
    }

    // 2b. Another page's work ("Apply leave" on the Attendance tab): say where, with no tool.
    const away = module.elsewhere?.(latestText);
    if (away) {
      answer({ text: away });
      return;
    }

    // 3. A reply that only fills in what a draft is waiting for ("mike@company.com").
    const draft = conversation.draft;
    const draftTool = draft ? tools.find((t) => t.name === draft.tool) : undefined;
    if (draft && draftTool?.fillFromReply) {
      const filled = await draftTool.fillFromReply(draft, latestText, api, ctx);
      if (filled) {
        // The server read these values from the reply itself ("Friday" → 2026-10-23), so they
        // count as its own, like a button's: re-checking them against the reply's words would drop them.
        await dispatch(draftTool, filled, false, { ...ctx, fromButton: true });
        return;
      }
    }

    // 4. A message the module reads on its own ("Download employees and projects"): no model call.
    const direct = module.direct?.(latestText, ctx);
    const directTool = direct ? tools.find((t) => t.name === direct.name) : undefined;
    if (direct && directTool) {
      const parsed = directTool.input.safeParse(direct.args);
      if (parsed.success) {
        await dispatch(directTool, parsed.data as Record<string, unknown>, true);
        return;
      }
    }

    // 5. The model picks a tool.
    const messages: ModelMessage[] = [
      {
        role: 'system',
        content: module.systemPrompt({ userName: user.name ?? 'there', role: user.role, today: ctx.today, weekday: weekdayOf(ctx.today), tools: tools.map((t) => t.name) }),
      },
      ...history.map((m) => ({ role: m.role, content: m.content }) as ModelMessage),
    ];
    if (draft && draftTool) {
      messages.push({
        role: 'system',
        content: `The user is giving details for ${draft.tool}. Still missing: ${draft.missing.join(', ') || 'nothing'}. If the next message gives any of them, call ${draft.tool} with just those details.`,
      });
    }
    messages.push({ role: 'user', content: latestText });
    const modelTools = modelToolsFor(module, tools);

    await modelQueue.run(
      async () => {
        let garbled = false;
        for (let step = 0; step < env.AI_MAX_TOOL_STEPS; step++) {
          emit({ type: 'status', state: 'thinking' });
          // Stream text answers as they come, but never a tool call the model wrote out as JSON.
          let streamed = '';
          const onToken = (text: string) => {
            streamed += text;
            if (!/^\s*[{`]/.test(streamed)) emit({ type: 'token', text });
          };
          const reply = await model.chat({ messages, tools: modelTools, signal, onToken });
          let call = reply.toolCalls[0];
          if (!call) {
            const written = toolCallFromText(reply.content);
            if (written === 'malformed') {
              garbled = true;
              messages.push({ role: 'assistant', content: reply.content });
              messages.push({ role: 'system', content: 'That was not a valid tool call. Call one of the tools again, with valid arguments.' });
              continue;
            }
            if (!written) {
              const text = reply.content.trim();
              // A plain answer after a broken tool call, or one claiming a change, can't be trusted.
              answer({ text: !text ? "Sorry, I didn't understand that. Try rephrasing, or use one of the suggestions." : garbled || claimsChange(text) ? untrusted(text) : text });
              return;
            }
            call = written;
          }
          messages.push({ role: 'assistant', content: reply.content, tool_calls: [{ function: { name: call.name, arguments: call.args } }] });
          const tool = tools.find((t) => t.name === call.name);
          if (!tool) {
            messages.push({ role: 'tool', content: `There is no tool called ${call.name}. Use one of: ${tools.map((t) => t.name).join(', ')}.` });
            continue;
          }
          const parsed = tool.input.safeParse(call.args);
          if (!parsed.success) {
            messages.push({ role: 'tool', content: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` });
            continue;
          }
          const data = await dispatch(tool, parsed.data as Record<string, unknown>);
          if (data === null) return;
          messages.push({ role: 'tool', content: data });
        }
        answer({ text: "I couldn't finish that. Please try again with different words, or use the page." });
      },
      (ahead) => emit({ type: 'status', state: 'queued', ahead }),
      signal
    );
  } catch (err) {
    if (signal.aborted) return;
    if (err instanceof AiUserError || err instanceof ApiCallError) answer({ text: err.message });
    else if (err instanceof ModelUnavailableError) emit({ type: 'error', code: 'AI_OFFLINE', message: `The assistant is offline: ${err.message}` });
    else {
      console.error('AI turn failed', err);
      emit({ type: 'error', message: 'Something went wrong. Please try again.' });
    }
  } finally {
    if (!signal.aborted) {
      await conversation.save();
      emit({ type: 'done', conversationId: String(conversation._id) });
    }
  }
}

export interface ConfirmInput {
  user: AuthenticatedUser;
  subscription?: SubscriptionState;
  token: string;
  actionId: string;
  values?: unknown;
  /** The file chosen on the card, for calls marked `attachFile` (documents). */
  file?: UploadedFile;
  api?: ApiClient;
}

async function findAction(user: AuthenticatedUser, actionId: string) {
  const conversation = await AiConversationModel.findOne({
    organizationId: new Types.ObjectId(user.organizationId!),
    userId: new Types.ObjectId(user.id),
    'pendingActions._id': new Types.ObjectId(actionId),
  });
  const action = conversation?.pendingActions.id(actionId);
  if (!conversation || !action) throw new ApiError(404, 'This confirmation was not found.');
  expireStale(conversation);
  if (action.status === 'expired') {
    await conversation.save();
    throw new ApiError(410, 'This confirmation expired. Please ask again.');
  }
  if (action.status !== 'pending') throw new ApiError(409, 'This was already handled.');
  return { conversation, action };
}

/**
 * Confirm: runs the card's calls (rebuilt from the user's edits, if any) with the token
 * of this request. Secrets in the results (a temporary password) go to the browser once
 * and are never stored. A refused call leaves the card open, so the user can fix it.
 */
export async function confirmAction(input: ConfirmInput): Promise<{ message: ChatMessageView; action: ActionView; secrets: { label: string; value: string }[] }> {
  const { conversation, action } = await findAction(input.user, input.actionId);
  // Checked again at Confirm: the role or plan may have changed since the card was shown.
  const module = getModule(conversation.module);
  if (!module || !(await canUseModule(module, input.user, input.subscription))) throw new ApiError(403, 'This assistant is not available to you.');
  const tool = (await allowedTools(module, input.user)).find((t) => t.name === action.tool);
  if (!tool) throw new ApiError(403, 'That action is not available to you.');
  const api = input.api ?? createApiClient(input.token);
  const ctx = toolContext(conversation, input.user, '', { form: false, fromButton: true });

  let calls = action.calls ?? [];
  const results: unknown[] = [];
  const close = async (result: AiResult, secrets: { label: string; value: string }[]) => {
    action.status = 'confirmed';
    action.calls = calls;
    action.resultText = result.text;
    conversation.markModified('pendingActions');
    const saved = addMessage(conversation, { role: 'assistant', content: summaryForModel(result), result });
    await conversation.save();
    return { message: messageView(conversation, saved), action: actionView(action), secrets };
  };
  try {
    if (input.values !== undefined && tool.revise) calls = await tool.revise(pendingView(action), input.values, api, ctx, Boolean(input.file));
    if (!calls.length) throw new AiUserError('Fill in the missing details first.');
    // Judged on the calls as revised: a receipt the edited amount no longer needs is skipped instead.
    if (action.card.file?.required && !input.file && calls.some((c) => c.attachFile && !c.skipWithoutFile)) throw new AiUserError('Choose a file first.');
    const secrets: { label: string; value: string }[] = [];
    for (const call of calls) {
      // An optional file left out: its call is skipped (its place in `results` is kept for placeholders).
      if (call.skipWithoutFile && !input.file) {
        results.push(null);
        continue;
      }
      // The file goes only with the call that asked for it; it is never stored with the action.
      const split = takeSecrets(await api.send({ ...call, path: fillPath(call.path, results) }, call.attachFile ? input.file : undefined));
      results.push(split.clean);
      secrets.push(...split.secrets);
    }
    return await close(tool.done ? tool.done(results, { ...pendingView(action), calls }) : { text: '✅ Done.' }, secrets);
  } catch (err) {
    // Some calls already ran (the claim exists, its submit failed): close the card with what was
    // saved, so a second Confirm can't make the claim again.
    if (results.some((r) => r !== null) && (err instanceof ApiCallError || err instanceof AiUserError)) {
      const pending = { ...pendingView(action), calls };
      const result = tool.partial ? tool.partial(results, err.message, pending) : { text: `Part of this was saved, but the rest failed: ${err.message}`, warnings: [err.message] };
      return close(result, []);
    }
    if (err instanceof AiUserError) throw new ApiError(400, err.message, err.details);
    // 4xx statuses pass through, so the client's usual 401 refresh and 402 plan handling apply.
    if (err instanceof ApiCallError) throw new ApiError(err.status >= 500 ? 502 : err.status, err.message, err.details);
    throw err;
  }
}

export async function cancelAction(user: AuthenticatedUser, actionId: string): Promise<{ message: ChatMessageView; action: ActionView }> {
  const { conversation, action } = await findAction(user, actionId);
  action.status = 'cancelled';
  conversation.markModified('pendingActions');
  const saved = addMessage(conversation, { role: 'assistant', content: 'The user cancelled. Nothing was changed.', result: { text: 'Cancelled. Nothing was changed.' } });
  await conversation.save();
  return { message: messageView(conversation, saved), action: actionView(action) };
}

export async function conversationView(user: AuthenticatedUser, id: string) {
  const conversation = await AiConversationModel.findOne({ _id: id, organizationId: user.organizationId, userId: user.id });
  if (!conversation) throw new ApiError(404, 'Conversation not found');
  expireStale(conversation);
  return {
    id: String(conversation._id),
    module: conversation.module,
    updatedAt: conversation.updatedAt,
    messages: conversation.messages.map((m) => messageView(conversation, m)),
  };
}
