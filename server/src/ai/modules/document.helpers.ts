// Pure helpers for the Documents assistant (docs/AI_DOCUMENTS_ASSISTANT.md, sections 2 and 8).
// The model copies the user's words; these turn them into statuses and categories, find the
// words that name a document, and decide which of the model's values the user really gave.

import { DOCUMENT_STATUSES, DocumentStatus } from '../../models/document.model';
import { grounded, heardText, isBlank, norm, sameText, str, stripCommandWords } from '../text';

export { DOCUMENT_STATUSES };
export type { DocumentStatus };

export const STATUS_LABELS: Record<DocumentStatus, string> = { active: 'Active', archived: 'Archived' };

// Checked in order, on norm()-ed text: "unarchive" before "archive".
const STATUS_WORDS: [DocumentStatus, RegExp][] = [
  ['active', /\b(?:active|restored?|restoring|un ?archived?|reactivated?|bring back|make it live)\b/],
  ['archived', /\b(?:archived?|archiving|retired?|obsolete|outdated|inactive)\b/],
];

/** "archive" -> 'archived', "restore" -> 'active'. Null when the words name no status. */
export function statusFromWords(text: string): DocumentStatus | null {
  const exact = text.trim().toLowerCase();
  if ((DOCUMENT_STATUSES as readonly string[]).includes(exact)) return exact as DocumentStatus;
  const t = norm(text);
  return STATUS_WORDS.find(([, pattern]) => pattern.test(t))?.[0] ?? null;
}

/** Every status the words mention, without counting "unarchive" as archive too. */
export function statusesIn(text: string): DocumentStatus[] {
  let t = norm(text);
  const found = new Set<DocumentStatus>();
  for (const [status, pattern] of STATUS_WORDS) {
    if (pattern.test(t)) {
      found.add(status);
      t = t.replace(new RegExp(pattern.source, 'g'), ' ');
    }
  }
  return [...found];
}

/** The existing spelling of a category the user named ("hr" -> "HR"), or null for a new one. */
export function matchCategory(categories: string[], said: string): string | null {
  const s = norm(said);
  return categories.find((c) => norm(c) === s) ?? null;
}

// Words that never name a document: verbs, fillers and the module's own nouns.
const NOT_DOCUMENT_WORDS = new Set(
  `upload uploaded add create new delete remove rename archive archived restore unarchive download replace replaced change update move
  version latest file files document documents doc docs pdf the a an my our this that these those please now also
  category called named titled under into onto from for with and of to as is are was`.split(/\s+/)
);

/** "Download the handbook document" -> "handbook": the words that name a document. */
export function documentQuery(said: string): string {
  const words = stripCommandWords(said)
    .split(/\s+/)
    .filter((w) => !['the', 'a', 'an', 'my', 'our', 'this', 'that', 'document', 'doc', 'file', 'pdf'].includes(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')));
  return words.join(' ').trim() || said.trim();
}

/** The words of a query a title must hold, in any order. */
export function documentWords(query: string): string[] {
  return norm(query)
    .split(' ')
    .filter((w) => w.length >= 3 && !NOT_DOCUMENT_WORDS.has(w) && !/^\d+$/.test(w));
}

/** What a message names, when the model didn't say which document: what is left after the verbs and fillers. */
export function documentFromMessage(text: string, others: string[]): string | undefined {
  const skip = new Set(others.flatMap((o) => norm(o).split(' ')));
  const words = documentWords(text).filter((w) => !skip.has(w));
  return words.length ? words.join(' ') : undefined;
}

// The user's own word for adding, deleting or replacing a file: what makes the model's choice of tool real.
const UPLOAD_WORDS = /\b(?:upload|add|create|new|attach|put up|share|save|store|daal|dalo|upload kar)\b/;
export const asksToUpload = (text: string) => UPLOAD_WORDS.test(norm(text));

const DELETE_WORDS = /\b(?:delete|remove|discard|erase|trash|scrap|get rid of|hatao|hata do|mita do)\b/;

// A download starts by itself only when the message asks for one now.
const DOWNLOAD_WORDS = /\b(?:download|downloads|get|give|send|share|open|save|need|want|again|same|copy|bhej|bhejo|de do|dedo|chahiye)\b/;
export const asksToDownload = (text: string) => DOWNLOAD_WORDS.test(norm(text));
export const asksToDelete = (text: string) => DELETE_WORDS.test(norm(text));

// "Upload a new version of the handbook", "Replace the handbook's file".
const NEW_FILE_WORDS = /\b(?:replace|replacing|new version|newer version|latest version|new file|re ?upload|update the file|change the file|swap the file|upload (?:a |the )?new|naya version|nayi file|naya file)\b/;
export const asksForNewFile = (text: string) => NEW_FILE_WORDS.test(norm(text));

// What each change needs in the user's own words. In the first eval run the model copied the
// document's name into other fields ("Archive the travel policy" came with category "Travel
// Policy"), so a field changes only when the message asks for that kind of change.
const RENAME_WORDS = /\b(?:rename|renamed|retitle|call (?:it|the|this)|title it|change (?:the |its )?(?:title|name)|new (?:title|name))\b/;
const CATEGORY_WORDS = /\b(?:category|recategori[sz]e|file (?:it )?under)\b|\bmove\b.*\bto\b|\bput\b.*\b(?:in|under|into)\b/;
const DESCRIPTION_WORDS = /\b(?:description|describe|summary)\b/;
export const asksToRename = (text: string) => RENAME_WORDS.test(norm(text));
export const asksToRecategorize = (text: string) => CATEGORY_WORDS.test(norm(text));
export const asksToRedescribe = (text: string) => DESCRIPTION_WORDS.test(norm(text));

/**
 * The category to use: an existing one the model named (in its spelling), else the one existing
 * category the message names ("… under HR: steps for new joiners" came back as "HR: steps for new
 * joiners"), else the model's words up to any colon, as a new category.
 */
export function resolveCategory(said: string, categories: string[], message: string): { category: string; isNew: boolean } {
  const existing = matchCategory(categories, said);
  if (existing) return { category: existing, isNew: false };
  const named = categories.filter((c) => ` ${norm(message)} `.includes(` ${norm(c)} `));
  if (named.length === 1) return { category: named[0], isNew: false };
  const cut = said.split(/\s*[:;]\s*/)[0].trim() || said.trim();
  return { category: matchCategory(categories, cut) ?? cut, isNew: !matchCategory(categories, cut) };
}

// A count asked as a question about which documents ("Which documents are archived?") wants the list.
const WHICH = /^(?:which|what|show|list|find|get|give)\b/;
export const asksWhich = (text: string) => WHICH.test(norm(text)) && !/\b(?:how many|count|number of|total)\b/.test(norm(text));

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A title as the model gave it, without the request around it: "upload document called Employee
 * handbook under HR" -> "Employee handbook", when HR is the document's category (`around`).
 */
export function cleanDocumentTitle(title: string, around: (string | undefined)[]): string {
  let t = title.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
  t = t.replace(/^(?:please\s+)?(?:upload|add|create|attach|new)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:document|doc|file|pdf)?\s*(?:called|named|titled|for|about|:)?\s*/i, '');
  for (let again = true; again; ) {
    again = false;
    for (const word of around.filter((w): w is string => Boolean(w && w.trim()))) {
      const next = t.replace(new RegExp(`\\s+(?:in|under|to|into|as|for)\\s+(?:the\\s+)?${escape(word.trim())}(?:\\s+category)?\\s*$`, 'i'), '');
      if (next !== t) [t, again] = [next, true];
    }
  }
  t = t.trim();
  return t ? t[0].toUpperCase() + t.slice(1) : title.trim();
}

export type DocumentArgs = Partial<Record<'title' | 'description' | 'category' | 'status', string>>;

/**
 * The model's values, cleaned: blanks dropped, a stray `name` read as the title, and a title,
 * description or category kept only if the user said it. A description that only repeats the
 * title was the model's.
 */
export function cleanDocumentArgs(raw: Record<string, unknown>, userText: string, fromButton: boolean): DocumentArgs {
  const args: DocumentArgs = {};
  const title = str(raw.title) ?? str(raw.name);
  if (title && (fromButton || heardText(title, userText))) args.title = title;
  const description = str(raw.description);
  if (description && (fromButton || heardText(description, userText))) args.description = description;
  // Categories are often short ("HR"), so any of their words will do.
  const category = str(raw.category);
  if (category && (fromButton || grounded(category, userText))) args.category = category;
  const status = str(raw.status);
  if (status) args.status = status;
  if (!fromButton && args.title && args.description && sameText(args.title, args.description)) delete args.description;
  return args;
}

// A reply that is a new request ("show my documents", "cancel") rather than the missing detail.
const NEW_REQUEST = /^(?:cancel|stop|never ?mind|no|nope|show|list|find|delete|remove|rename|archive|restore|download|count|how many|what|which|who)\b/i;

/** The fast path for a follow-up: when exactly one of title, description and category is missing, a plain reply fills it. */
export function fillDocumentFromText(missing: string[], reply: string): DocumentArgs | null {
  if (missing.length !== 1 || isBlank(reply)) return null;
  const text = reply.trim().replace(/[.!]+$/, '');
  if (!text || NEW_REQUEST.test(text)) return null;
  if (missing[0] === 'description') {
    const description = text.replace(/^(?:the )?(?:description is|description:|it'?s about|it is about|about)\s+/i, '');
    return description.length <= 1000 ? { description } : null;
  }
  if (missing[0] === 'title') {
    const title = text.replace(/^(?:call it|name it|it'?s called|it is called|the title is|title:)\s+/i, '');
    return title.split(/\s+/).length <= 12 ? { title } : null;
  }
  if (missing[0] === 'category') {
    const category = text.replace(/^(?:the )?(?:category is|category:|under|in|put it (?:in|under))\s+/i, '').replace(/\s+category$/i, '');
    return category.split(/\s+/).length <= 4 ? { category } : null;
  }
  return null;
}

/** 1 234 567 bytes -> "1.2 MB". */
export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
