import { z } from 'zod';
import { objectIdSchema } from '../../validators/objectId';
import { ApiCallError } from '../apiClient';
import { basePrompt } from '../prompts/base.prompt';
import { andList, colonDescription, grounded, heardText, isBlank, Match, mentions, mergeArgs, norm, orList, sameText, str } from '../text';
import { AiButton, AiModule, AiResult, AiTool, AiUserError, ApiClient, ConfirmCard, DocumentFormValues, Prepared, ToolContext } from '../types';
import {
  asksForNewFile,
  asksToDelete,
  asksToRecategorize,
  asksToRedescribe,
  asksToRename,
  asksToDownload,
  asksToUpload,
  asksWhich,
  cleanDocumentArgs,
  cleanDocumentTitle,
  DOCUMENT_STATUSES,
  DocumentArgs,
  documentFromMessage,
  documentQuery,
  DocumentStatus,
  documentWords,
  fileSize,
  fillDocumentFromText,
  matchCategory,
  resolveCategory,
  STATUS_LABELS,
  statusesIn,
  statusFromWords,
} from './document.helpers';
import { isQuestion } from './exports.helpers';

// The Documents assistant (docs/AI_DOCUMENTS_ASSISTANT.md). Reads and writes go through the
// existing /documents endpoints with the user's own token. An upload's file is chosen on the
// confirm card and sent with the Confirm click (section 5); the model never sees a file.

interface DocumentRow {
  id: string;
  title: string;
  description: string;
  category: string;
  status: DocumentStatus;
  file: { id: string; originalName: string; mimeType: string; size: number } | null;
}

const PAGE_SIZE = 20;
const isObjectId = (value: string) => objectIdSchema.safeParse(value).success;

// The model sometimes sends numbers, nulls or the string "null"; everything is read as optional text.
// Short labels only: in testing the model copied longer hints in as values.
const text = (description: string) =>
  z.preprocess((v) => (isBlank(v) ? undefined : typeof v === 'string' ? v : String(v)), z.string().optional()).describe(description);

// ---------------------------------------------------------------- display

const fileText = (d: DocumentRow) => (d.file ? `${d.file.originalName} (${fileSize(d.file.size)})` : 'no file');
const short = (s: string, max = 60) => (s.length > max ? `${s.slice(0, max - 3)}…` : s);
const documents = (n: number) => `document${n === 1 ? '' : 's'}`;

function documentLine(d: DocumentRow): string {
  return `**${d.title}** · ${d.category} · ${STATUS_LABELS[d.status]} · ${fileText(d)} · ${d.description}`;
}

/** The document's file for the browser to download, as on the page's Download button. */
const downloadsOf = (d: DocumentRow) => (d.file ? [{ label: d.file.originalName, path: `/documents/${d.id}/file` }] : undefined);

function whichDocument(question: string, items: DocumentRow[], toolCall: (id: string) => AiButton['toolCall']): Extract<Prepared, { kind: 'ask' }> {
  return { kind: 'ask', result: { text: question, buttons: items.slice(0, 6).map((d) => ({ label: `${d.title} · ${d.category}`, toolCall: toolCall(d.id) })) } };
}

// ---------------------------------------------------------------- lookups

/** Every document, a page of 100 at a time (up to 500), for categories and counts per category. */
async function loadAll(api: ApiClient): Promise<DocumentRow[]> {
  const all: DocumentRow[] = [];
  for (let page = 1; page <= 5; page++) {
    const { data, meta } = await api.page<DocumentRow[]>('/documents', { limit: 100, page, sortBy: 'title', sortDir: 'asc' });
    all.push(...data);
    if (page * 100 >= (meta.total ?? 0)) break;
  }
  return all;
}

/** The categories in use, each as first spelled. */
async function loadCategories(api: ApiClient): Promise<string[]> {
  const seen = new Map<string, string>();
  for (const d of await loadAll(api)) if (!seen.has(norm(d.category))) seen.set(norm(d.category), d.category);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

const categoryOptions = (categories: string[]) => (categories.length && categories.length <= 8 ? ` (${orList(categories)})` : '');

/** The document the user means: by id, by its title, or by its words in any order ("the handbook"). */
async function findDocument(api: ApiClient, said: string): Promise<Match<DocumentRow>> {
  const query = documentQuery(said);
  if (isObjectId(query)) {
    try {
      return { kind: 'one', item: await api.get<DocumentRow>(`/documents/${query}`) };
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 404) return { kind: 'none' };
      throw err;
    }
  }
  let hits = await api.get<DocumentRow[]>('/documents', { search: query, limit: 20 });
  const words = documentWords(query);
  if (!hits.length && words.length) {
    // Titles holding the words in any order; failing that, all of them but one, from searches on the three longest.
    const pool = new Map<string, DocumentRow>();
    for (const word of [...words].sort((a, b) => b.length - a.length).slice(0, 3)) {
      (await api.get<DocumentRow[]>('/documents', { search: word, limit: 50 })).forEach((d) => pool.set(d.id, d));
    }
    const score = (d: DocumentRow) => words.filter((w) => norm(d.title).includes(w)).length;
    hits = [...pool.values()].filter((d) => score(d) === words.length);
    if (!hits.length && words.length > 1) hits = [...pool.values()].filter((d) => score(d) >= words.length - 1);
  }
  // Only an exact title wins outright: one that merely holds the words is no better than another.
  const exact = hits.filter((d) => norm(d.title) === norm(query));
  if (exact.length === 1) return { kind: 'one', item: exact[0] };
  return hits.length === 1 ? { kind: 'one', item: hits[0] } : hits.length ? { kind: 'many', items: hits } : { kind: 'none' };
}

// ---------------------------------------------------------------- status

const unknownStatus = (said: string) => `"${said}" isn't a document status. Use ${orList(DOCUMENT_STATUSES.map((s) => STATUS_LABELS[s]))}.`;

/** The text without one occurrence of each word: a document's own words ("Archive policy") aren't a status. */
function without(textIn: string, words: string[]): string {
  let t = ` ${norm(textIn)} `;
  for (const w of words) t = t.replace(` ${w} `, ' ');
  return t;
}

/** A status only when the user mentioned one in `said`; a button's is the server's own. */
function pickStatus(words: string | undefined, ctx: ToolContext, said = ctx.latestText): { status?: DocumentStatus; problem?: string } {
  if (!words) return {};
  const s = statusFromWords(words);
  if (ctx.fromButton) return s ? { status: s } : { problem: unknownStatus(words) };
  const mentioned = statusesIn(said);
  if (!mentioned.length) return {};
  if (s && mentioned.includes(s)) return { status: s };
  if (mentioned.length === 1) return { status: mentioned[0] };
  return { problem: unknownStatus(words) };
}

// ---------------------------------------------------------------- read tools

interface ReadFilters {
  query: Record<string, unknown>;
  where: string[];
  status?: DocumentStatus;
  answer?: AiResult;
}

/**
 * The model's filter words → API filters. A category that isn't one is read as search words
 * ("Show leave documents" when there is no Leave category); an unreadable status is dropped
 * unless it's a plain unknown word.
 */
async function readFilters(args: { search?: string; category?: string; status?: string }, api: ApiClient, ctx: ToolContext): Promise<ReadFilters> {
  const heard = (value: string | undefined) => (value && (ctx.fromButton || grounded(value, ctx.latestText)) ? value : undefined);
  const out: ReadFilters = { query: {}, where: [] };
  const statusWords = heard(str(args.status));
  if (statusWords) {
    const status = statusFromWords(statusWords);
    if (status) {
      out.status = status;
      out.query.status = status;
    } else if (/^\p{L}+$/u.test(statusWords) && !/^status(?:es)?$/i.test(statusWords)) return { ...out, answer: { text: unknownStatus(statusWords) } };
  }
  let search = heard(str(args.search));
  const categoryWords = heard(str(args.category));
  if (categoryWords) {
    const category = matchCategory(await loadCategories(api), categoryWords);
    if (category) {
      out.query.category = category;
      out.where.push(`in ${category}`);
    } else search ??= categoryWords;
  }
  if (search) {
    out.query.search = documentQuery(search);
    out.where.unshift(`matching "${documentQuery(search)}"`);
  }
  return out;
}

const listInput = z.object({
  search: text('Title words'),
  category: text('Category'),
  status: text('Status'),
  page: z.preprocess((v) => (isBlank(v) ? undefined : v), z.coerce.number().int().min(1).optional()),
});

const listDocuments: AiTool<z.infer<typeof listInput>> = {
  name: 'list_documents',
  label: 'Looking up documents',
  kind: 'read',
  requires: 'read',
  description: 'Show or search documents, by category or status. Only for looking at documents, not for changing them.',
  input: listInput,
  async run(args, api, ctx) {
    const f = await readFilters(args, api, ctx);
    if (f.answer) return f.answer;
    const page = args.page ?? 1;
    const { data, meta } = await api.page<DocumentRow[]>('/documents', { ...f.query, page, limit: PAGE_SIZE, sortBy: 'title', sortDir: 'asc' });
    const total = meta.total ?? data.length;
    const where = f.where.length ? ` ${f.where.join(', ')}` : '';
    const noun = `${f.status ? `${f.status} ` : ''}${documents(total)}`;
    if (total === 0) return { text: where || f.status ? `No ${noun}${where}.` : 'There are no documents yet.' };
    if (total === 1 && page === 1) return { text: documentLine(data[0]), downloads: downloadsOf(data[0]), autoDownload: false };
    const from = (page - 1) * PAGE_SIZE + 1;
    const to = from + data.length - 1;
    return {
      text: `**${total} ${noun}**${where}.${total > data.length ? ` Showing ${from}–${to}.` : ''}`,
      table: {
        columns: [
          { key: 'title', title: 'Title' },
          { key: 'category', title: 'Category' },
          { key: 'status', title: 'Status' },
          { key: 'file', title: 'File' },
        ],
        rows: data.map((d) => ({ title: short(d.title), category: d.category, status: STATUS_LABELS[d.status], file: d.file ? short(fileText(d), 40) : '—' })),
      },
      buttons: to < total ? [{ label: 'Show more', toolCall: { name: 'list_documents', args: { ...args, page: page + 1 } } }] : undefined,
    };
  },
};

const countInput = z.object({ category: text('Category'), status: text('Status') });

const countDocuments: AiTool<z.infer<typeof countInput>> = {
  name: 'count_documents',
  label: 'Counting documents',
  kind: 'read',
  requires: 'read',
  description: 'Count documents, optionally by category or status.',
  input: countInput,
  async run(args, api, ctx) {
    // "Which documents are archived?" came back as a count: a question about which ones wants the list.
    if (!ctx.fromButton && asksWhich(ctx.latestText)) return listDocuments.run!(args, api, ctx);
    const f = await readFilters(args, api, ctx);
    if (f.answer) return f.answer;
    if (f.query.search) {
      // A category word that isn't a category: say so, with the real ones.
      const categories = await loadCategories(api);
      return { text: `There is no category called "${String(args.category)}".${categories.length ? ` Categories: ${andList(categories)}.` : ''}` };
    }
    if (f.query.category || f.query.status) {
      const total = (await api.page<DocumentRow[]>('/documents', { ...f.query, limit: 1 })).meta.total ?? 0;
      const where = f.where.length ? ` ${f.where.join(', ')}` : '';
      return {
        text: `**${total} ${f.status ? `${f.status} ` : ''}${documents(total)}**${where}.`,
        buttons: total ? [{ label: 'Show them', toolCall: { name: 'list_documents', args: { category: f.query.category, status: f.status } } }] : undefined,
      };
    }
    const all = await loadAll(api);
    if (!all.length) return { text: 'There are no documents yet.' };
    const counts = new Map<string, { name: string; n: number }>();
    for (const d of all) {
      const key = norm(d.category);
      counts.set(key, { name: counts.get(key)?.name ?? d.category, n: (counts.get(key)?.n ?? 0) + 1 });
    }
    return {
      text: `**${all.length} ${documents(all.length)}** in total.`,
      table: {
        columns: [
          { key: 'category', title: 'Category' },
          { key: 'count', title: 'Documents' },
        ],
        rows: [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map((c) => ({ category: c.name, count: String(c.n) })),
      },
    };
  },
};

const downloadInput = z.object({ document: text('The document') });

const downloadDocument: AiTool<z.infer<typeof downloadInput>> = {
  name: 'download_document',
  label: 'Finding the document',
  kind: 'read',
  requires: 'read',
  description: "Download a document's file.",
  input: downloadInput,
  async run(args, api, ctx) {
    const which = str(args.document) ?? (ctx.fromButton ? undefined : documentFromMessage(ctx.latestText, []));
    if (!which) return { text: 'Which document do you want to download?' };
    const found = await findDocument(api, which);
    if (found.kind === 'none') return { text: `No document matches "${documentQuery(which)}".` };
    if (found.kind === 'many') return whichDocument(`${found.items.length} documents match "${documentQuery(which)}". Which one?`, found.items, (id) => ({ name: 'download_document', args: { document: id } })).result;
    const d = found.item;
    if (!d.file) return { text: `**${d.title}** has no file yet. To add one, say "Upload a new version of ${d.title}".` };
    // As on Exports: the browser downloads it from the existing endpoint, and only for a message that
    // asks for it now; a question, or one that doesn't ask ("that's helpful"), only offers it.
    const wanted = ctx.fromButton || (asksToDownload(ctx.latestText) && !isQuestion(ctx.latestText));
    return { text: `**${d.title}**: ${fileText(d)}.`, downloads: downloadsOf(d), autoDownload: wanted };
  },
};

// ---------------------------------------------------------------- create

const createInput = z
  .object({
    title: text('Title'),
    description: text('Description'),
    category: text('Category'),
    status: text('Status'),
  })
  // Kept: the model sometimes sends `name` for the title.
  .passthrough();

const REQUIRED = ['title', 'description', 'category'] as const;
const ASK_LABELS: Record<(typeof REQUIRED)[number], string> = { title: 'the **title**', description: 'a short **description**', category: 'the **category**' };

/** The form values the card edits, and what Confirm checks them against (as createDocumentSchema does). */
const documentValuesSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().trim().min(1, 'Description is required'),
  category: z.string().trim().min(1, 'Category is required'),
  status: z.enum(DOCUMENT_STATUSES),
});

const bodyOf = (v: DocumentFormValues) => ({ title: v.title.trim(), description: v.description.trim(), category: v.category.trim(), status: v.status });
const formButton: AiButton = { label: 'Fill in the form instead', toolCall: { name: 'create_document', args: {}, form: true } };

const createDocument: AiTool<z.infer<typeof createInput>> = {
  name: 'create_document',
  label: 'Preparing the upload',
  kind: 'write',
  requires: 'create',
  description: 'Upload a new document, only when the user asks to upload or add one. The app asks for the file; the user confirms before it is saved.',
  input: createInput,

  async prepare(raw, api, ctx) {
    const draft = ctx.draft?.tool === 'create_document' ? ctx.draft : null;
    // A new version of an existing document, or a change with no word for adding, is an update (as on Tasks).
    if (!ctx.fromButton && !ctx.form && !draft && (asksForNewFile(ctx.latestText) || (!asksToUpload(ctx.latestText) && statusesIn(ctx.latestText).length))) {
      return { kind: 'reroute', tool: 'update_document', args: { document: str(raw.title) ?? ctx.latestText } };
    }
    // "Move the payroll guide to the HR category" came back as a new upload: with no word for
    // uploading, a title that names an existing document is a change to it.
    if (!ctx.fromButton && !ctx.form && !draft && !asksToUpload(ctx.latestText) && str(raw.title)) {
      if ((await findDocument(api, String(raw.title))).kind !== 'none') {
        // The model's other fields go along; update_document keeps only what the message asks to change.
        return { kind: 'reroute', tool: 'update_document', args: { document: String(raw.title), category: raw.category, status: raw.status, description: raw.description } };
      }
    }
    const given = cleanDocumentArgs(raw, ctx.userText, ctx.fromButton);
    // "Upload the handbook, under HR: the rules for everyone": what follows the colon is the description.
    if (!ctx.fromButton && !given.description && !draft?.args.description) {
      const described = colonDescription(ctx.latestText);
      if (described && !(given.title && sameText(described, given.title))) given.description = described;
    }
    const problems: string[] = [];
    const picked = pickStatus(given.status, ctx);
    if (picked.problem) problems.push(picked.problem);
    if (picked.status) given.status = picked.status;
    else delete given.status;
    const args = mergeArgs<DocumentArgs>((draft?.args ?? {}) as DocumentArgs, given) as DocumentArgs;

    const categories = await loadCategories(api);
    const notes: string[] = [];
    if (args.category) {
      // One spelling per category ("hr" is filed under "HR"), and an existing one the message names wins.
      const resolved = ctx.fromButton ? { category: matchCategory(categories, args.category) ?? args.category, isNew: !matchCategory(categories, args.category) } : resolveCategory(args.category, categories, ctx.latestText);
      args.category = resolved.category;
      if (resolved.isNew) notes.push(`"${resolved.category}" is a new category.`);
    } else if (!ctx.fromButton) {
      const named = categories.filter((c) => mentions(ctx.latestText, c));
      if (named.length === 1) args.category = named[0];
    }
    if (args.title && !ctx.fromButton) args.title = cleanDocumentTitle(args.title, [args.category]);

    const warnings: string[] = [];
    if (args.title) {
      // Titles aren't unique, so a second one is allowed, but worth a warning.
      const same = (await api.get<DocumentRow[]>('/documents', { search: args.title, limit: 10 })).find((d) => norm(d.title) === norm(args.title!));
      if (same) warnings.push(`A document called "${same.title}" already exists (${same.category}).`);
    }

    const values: DocumentFormValues = { title: args.title ?? '', description: args.description ?? '', category: args.category ?? '', status: (args.status as DocumentStatus | undefined) ?? 'active' };
    const missing = REQUIRED.filter((f) => !values[f]);
    if (missing.length && !ctx.form) {
      const buttons: AiButton[] = [];
      if (missing.includes('category') && categories.length && categories.length <= 5) {
        buttons.push(...categories.map((c) => ({ label: c, toolCall: { name: 'create_document', args: { category: c } } })));
      }
      if (missing.includes('description') && values.title) buttons.push({ label: 'Same as the title', toolCall: { name: 'create_document', args: { description: values.title } } });
      buttons.push(formButton);
      const asks = missing.map((f) => (f === 'category' ? `${ASK_LABELS.category}${categoryOptions(categories)}` : ASK_LABELS[f]));
      return {
        kind: 'ask',
        result: {
          text: `${problems.length ? `${problems.join(' ')} ` : ''}I'll add ${values.title ? `**${values.title}**` : 'a new document'}. I still need ${andList(asks)}.`,
          buttons,
          warnings,
        },
        draft: {
          tool: 'create_document',
          args: Object.fromEntries(Object.entries({ title: values.title, description: values.description, category: values.category, status: args.status ? values.status : undefined }).filter(([, v]) => v)),
          missing: [...missing],
          notSaved: [],
        },
      };
    }
    const card: ConfirmCard = {
      title: 'Upload a document',
      tone: 'default',
      rows: [
        { label: 'Title', value: values.title || '—' },
        { label: 'Description', value: values.description || '—' },
        { label: 'Category', value: values.category || '—' },
        { label: 'Status', value: STATUS_LABELS[values.status] },
      ],
      warnings: [...problems, ...warnings],
      notes,
      confirmLabel: 'Upload document',
      form: { kind: 'document', mode: 'create', values, categories },
      incomplete: missing.length > 0,
      // Chosen on the card and sent with the Confirm click: an upload through chat always has a file.
      file: { required: true },
    };
    return { kind: 'card', card, calls: missing.length ? [] : [{ method: 'POST', path: '/documents', body: bodyOf(values), attachFile: true }] };
  },

  async fillFromReply(draft, reply, api) {
    if (draft.tool !== 'create_document') return null;
    const filled = fillDocumentFromText(draft.missing, reply);
    if (filled?.category) filled.category = matchCategory(await loadCategories(api), filled.category) ?? filled.category;
    return filled;
  },

  async revise(_pending, values) {
    const parsed = documentValuesSchema.safeParse(values);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    return [{ method: 'POST', path: '/documents', body: bodyOf(parsed.data), attachFile: true }];
  },

  done([result]) {
    const d = result as DocumentRow;
    return { text: `✅ **Document uploaded:** ${d.title} · ${d.category}${d.file ? ` · ${fileText(d)}` : ''}.` };
  },
};

// ---------------------------------------------------------------- update

const updateInput = z
  .object({
    document: text('The document'),
    newTitle: text('New title'),
    description: text('New description'),
    category: text('New category'),
    status: text('New status'),
  })
  // Kept: the model sometimes sends `title` or `name` for the document itself; buttons carry `replaceFile`.
  .passthrough();

const FIELD_TITLES: Record<keyof DocumentFormValues, string> = { title: 'Title', description: 'Description', category: 'Category', status: 'Status' };
const FIELDS = Object.keys(FIELD_TITLES) as (keyof DocumentFormValues)[];

function toValues(d: DocumentRow): DocumentFormValues {
  return { title: d.title, description: d.description, category: d.category, status: d.status };
}

/** The changed fields, as API values. */
function diffValues(current: DocumentRow, v: DocumentFormValues): Partial<DocumentFormValues> {
  const before = toValues(current);
  const changed: Partial<DocumentFormValues> = {};
  for (const key of FIELDS) if (String(v[key]).trim() !== String(before[key]).trim()) (changed as Record<string, string>)[key] = String(v[key]).trim();
  return changed;
}

const shown = (key: keyof DocumentFormValues, value: string) => (key === 'status' ? STATUS_LABELS[value as DocumentStatus] : value);

const updateDocument: AiTool<z.infer<typeof updateInput>> = {
  name: 'update_document',
  label: 'Preparing the change',
  kind: 'write',
  requires: 'update',
  description: 'Change an existing document: rename it, change its description or category, archive or restore it, or upload a new version of its file. The user confirms before saving.',
  input: updateInput,

  async prepare(input, api, ctx) {
    const args: Record<string, unknown> = { ...input };
    for (const key of ['title', 'name']) {
      if (str(args[key])) {
        if (!str(args.document)) args.document = args[key];
        else if (!str(args.newTitle)) args.newTitle = args[key];
      }
      delete args[key];
    }
    const message = ctx.fromButton ? '' : ctx.latestText;
    const which = str(args.document) ?? (ctx.fromButton ? undefined : documentFromMessage(message, []));
    if (!which) return { kind: 'ask', result: { text: 'Which document do you want to change?' } };
    const found = await findDocument(api, which);
    if (found.kind === 'none') return { kind: 'ask', result: { text: `No document matches "${documentQuery(which)}".` } };

    // Checked before a "which one?" question, so its buttons carry only values the user gave. The
    // document's own title isn't a status ("Archive policy"): its words are set aside once each.
    const titles = found.kind === 'one' ? [found.item.title] : found.items.map((d) => d.title);
    const said = without(ctx.latestText, norm(titles[0]).split(' ').filter((w) => titles.every((t) => ` ${norm(t)} `.includes(` ${w} `))));
    // Each field changes only when the message asks for that kind of change (the model copies the
    // document's name into other fields), and with the user's own words.
    const newTitle = str(args.newTitle) && (ctx.fromButton || (asksToRename(ctx.latestText) && heardText(String(args.newTitle), ctx.userText))) ? str(args.newTitle) : undefined;
    const description =
      str(args.description) && (ctx.fromButton || (asksToRedescribe(ctx.latestText) && heardText(String(args.description), ctx.userText))) ? str(args.description) : undefined;
    let categoryWords =
      str(args.category) && (ctx.fromButton || (asksToRecategorize(ctx.latestText) && grounded(String(args.category), ctx.userText))) ? str(args.category) : undefined;
    if (!categoryWords && !ctx.fromButton && asksToRecategorize(ctx.latestText) && found.kind === 'one') {
      // "Move the payroll guide to the HR category" with no category from the model: the one other existing category the message names.
      const named = (await loadCategories(api)).filter((c) => norm(c) !== norm(found.item.category) && ` ${norm(ctx.latestText)} `.includes(` ${norm(c)} `));
      if (named.length === 1) categoryWords = named[0];
    }
    const mentioned = ctx.fromButton ? [] : statusesIn(said);
    const picked = pickStatus(str(args.status) ?? (mentioned.length === 1 ? mentioned[0] : undefined), ctx, said);
    const replaceFile = ctx.fromButton ? args.replaceFile === true : asksForNewFile(ctx.latestText);
    if (found.kind === 'many') {
      const keep = Object.fromEntries(Object.entries({ newTitle, description, category: categoryWords, status: picked.status, replaceFile: replaceFile || undefined }).filter(([, v]) => v !== undefined));
      return whichDocument(`${found.items.length} documents match "${documentQuery(which)}". Which one?`, found.items, (id) => ({ name: 'update_document', args: { ...keep, document: id } }));
    }

    const current = found.item;
    const values = toValues(current);
    const problems: string[] = picked.problem ? [picked.problem] : [];
    const notes: string[] = [];
    if (newTitle) values.title = newTitle;
    if (description) values.description = description;
    const categories = await loadCategories(api);
    if (categoryWords) {
      const resolved = ctx.fromButton ? { category: matchCategory(categories, categoryWords) ?? categoryWords, isNew: !matchCategory(categories, categoryWords) } : resolveCategory(categoryWords, categories, ctx.latestText);
      values.category = resolved.category;
      if (resolved.isNew) notes.push(`"${resolved.category}" is a new category.`);
    }
    if (picked.status) values.status = picked.status;

    const changed = diffValues(current, values);
    const keys = Object.keys(changed) as (keyof DocumentFormValues)[];
    const editButton: AiButton = { label: 'Edit in a form', toolCall: { name: 'update_document', args: { document: current.id }, form: true } };
    if (!keys.length && !replaceFile && !ctx.form) {
      const textOut = problems.length ? problems.join(' ') : `Nothing to change for **${current.title}**. Tell me what to change: title, description, category, status, or a new version of the file.`;
      return { kind: 'ask', result: { text: textOut, buttons: [editButton] } };
    }
    const before = toValues(current);
    const rows = keys.map((key) => ({ label: FIELD_TITLES[key], value: shown(key, changed[key]!), previous: shown(key, before[key]) }));
    if (replaceFile) rows.push({ label: 'File', value: 'The new file you choose', previous: current.file?.originalName ?? 'None' });
    return {
      kind: 'card',
      card: {
        title: `Update ${current.title}`,
        tone: 'default',
        rows: rows.length ? rows : [{ label: 'Document', value: current.title }],
        warnings: problems,
        notes,
        confirmLabel: replaceFile && !keys.length ? 'Upload new file' : 'Save',
        form: { kind: 'document', mode: 'update', values, categories },
        incomplete: !keys.length && !replaceFile,
        file: replaceFile ? { required: true, current: current.file?.originalName } : undefined,
      },
      calls: keys.length || replaceFile ? [{ method: 'PUT', path: `/documents/${current.id}`, body: changed, attachFile: replaceFile }] : [],
      meta: { documentId: current.id, replaceFile },
    };
  },

  async revise(pending, values, api) {
    const parsed = documentValuesSchema.safeParse(values);
    if (!parsed.success) throw new AiUserError('Some details need fixing.', parsed.error.flatten());
    const id = String(pending.meta.documentId);
    const replaceFile = pending.meta.replaceFile === true;
    const changed = diffValues(await api.get<DocumentRow>(`/documents/${id}`), parsed.data);
    if (!Object.keys(changed).length && !replaceFile) throw new AiUserError('Nothing was changed.');
    return [{ method: 'PUT', path: `/documents/${id}`, body: changed, attachFile: replaceFile }];
  },

  done([result], pending) {
    const d = result as DocumentRow;
    const body = (pending.calls[0]?.body ?? {}) as Record<string, unknown>;
    const now = toValues(d);
    const changes = (Object.keys(body) as (keyof DocumentFormValues)[]).map((key) => `${FIELD_TITLES[key].toLowerCase()} is now ${shown(key, now[key])}`);
    if (pending.meta.replaceFile && d.file) changes.push(`the file is now ${fileText(d)}`);
    return { text: `✅ Updated **${d.title}**${changes.length ? `: ${andList(changes)}` : ''}.` };
  },
};

// ---------------------------------------------------------------- delete

const deleteInput = z.object({ document: text('The document') });

const deleteDocument: AiTool<z.infer<typeof deleteInput>> = {
  name: 'delete_document',
  label: 'Finding the document',
  kind: 'write',
  requires: 'delete',
  description: 'Delete a document, only when the user asks to delete it. The user must confirm.',
  input: deleteInput,

  async prepare(args, api, ctx) {
    const which = str(args.document);
    // Without a word for deleting in the message, it's a change (as on Tasks).
    if (!ctx.fromButton && !asksToDelete(ctx.latestText)) return { kind: 'reroute', tool: 'update_document', args: which ? { document: which } : {} };
    const target = which ?? (ctx.fromButton ? undefined : documentFromMessage(ctx.latestText, []));
    if (!target) return { kind: 'ask', result: { text: 'Which document do you want to delete?' } };
    const found = await findDocument(api, target);
    if (found.kind === 'none') return { kind: 'ask', result: { text: `No document matches "${documentQuery(target)}".` } };
    // One at a time: chat never deletes several documents in one go.
    if (found.kind === 'many') {
      return whichDocument(`${found.items.length} documents match "${documentQuery(target)}". Which one do you want to delete?`, found.items, (id) => ({ name: 'delete_document', args: { document: id } }));
    }
    const d = found.item;
    return {
      kind: 'card',
      card: {
        title: `Delete ${d.title}?`,
        tone: 'danger',
        rows: [
          { label: 'Category', value: d.category },
          { label: 'Status', value: STATUS_LABELS[d.status] },
          { label: 'File', value: d.file ? fileText(d) : '—' },
          { label: 'Description', value: d.description },
        ],
        notes: ['This is the same as Delete on the Documents page.'],
        confirmLabel: 'Delete document',
      },
      calls: [{ method: 'DELETE', path: `/documents/${d.id}` }],
      meta: { documentId: d.id, title: d.title },
    };
  },

  done(_results, pending) {
    return { text: `✅ **${String(pending.meta.title)}** was deleted.` };
  },
};

// ---------------------------------------------------------------- module

const READ_TOOLS = ['list_documents', 'count_documents', 'download_document'];

export const documentModule: AiModule = {
  key: 'documents',
  title: 'Documents assistant',
  intro: () => 'Ask about documents, download them, or upload and change them by typing or speaking. Every change waits for your Confirm.',
  requiredPermission: { module: 'documents', action: 'read' },
  starters: [
    { label: 'Upload a document', toolCall: { name: 'create_document', args: {} } },
    { label: 'Show all documents', toolCall: { name: 'list_documents', args: {} } },
    { label: 'Archived documents', toolCall: { name: 'list_documents', args: { status: 'archived' } } },
    { label: 'Count by category', toolCall: { name: 'count_documents', args: {} } },
  ],
  systemPrompt: (ctx) => {
    const writes = ctx.tools.some((t) => !READ_TOOLS.includes(t));
    return `${basePrompt(ctx, 'documents')}
You are the Documents assistant. You help list, find, count and download documents${writes ? ', and upload, change or delete them' : ''}.
- Call a tool for every request, also when the user writes in Hindi or Hinglish.
- Fill in only details the user actually gave. Never make up a title, a description or a category.
- Copy titles, categories and statuses exactly as the user said them. The server finds the documents.${
      ctx.tools.includes('create_document') ? '\n- To upload or add a document, call create_document. The app asks for the file itself.' : ''
    }
- Never say that a document was uploaded, changed or deleted. The app shows that after the backend confirms it.`;
  },
  tools: [listDocuments, countDocuments, downloadDocument, createDocument, updateDocument, deleteDocument],
};
