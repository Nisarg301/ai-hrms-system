import { z } from 'zod';
import { EffectivePermissions } from '../../permissions/effectivePermissions';
import { basePrompt } from '../prompts/base.prompt';
import { andList, grounded, isBlank, str } from '../text';
import { AiButton, AiDownload, AiModule, AiResult, AiTool, ApiClient } from '../types';
import {
  asksForExport,
  asksForFilter,
  backedByUser,
  elsewhereNotes,
  EXPORTABLE_MODULES,
  ExportableModule,
  EXPORTS,
  formatNote,
  isQuestion,
  plainRequest,
  readRequest,
} from './exports.helpers';

// The Exports assistant (docs/AI_EXPORTS_ASSISTANT.md). It answers with a list of files; the
// browser downloads each one from the existing GET /exports/:module with the user's own token,
// as the page's CSV buttons do. No CSV ever passes through the chat or the model.

interface Me {
  user: { permissions: EffectivePermissions; subscription: { modules: string[] } | null };
}

/** The exports this user may download: the same rule as the page's cards and the endpoint (module: read). */
async function readableExports(api: ApiClient): Promise<ExportableModule[]> {
  const { user } = await api.get<Me>('/auth/me');
  const { permissions: p, subscription } = user;
  return EXPORTABLE_MODULES.filter((m) => {
    if (subscription && !subscription.modules.includes(m)) return false;
    if (p.scope === 'all') return true;
    return p.scope === 'matrix' && Boolean(p.entries.find((e) => e.module === m)?.read);
  });
}

const download = (m: ExportableModule): AiDownload => ({ label: `${EXPORTS[m].label} CSV`, path: `/exports/${m}` });
const labels = (modules: ExportableModule[]) => andList(modules.map((m) => EXPORTS[m].label));
const columnsText = (m: ExportableModule) => EXPORTS[m].columns.join(', ').replace(/^./, (c) => c.toUpperCase());
const withNotes = (text: string, notes: string[]) => (notes.length ? `${text}\n${notes.join(' ')}` : text);

/** "You can download these as CSV": the exports this user has, each with a button, for when nothing was named. */
function choices(readable: ExportableModule[], notes: string[]): AiResult {
  if (!readable.length) return { text: withNotes("Your role can't read any of the data that can be exported here.", notes) };
  const buttons: AiButton[] = readable.map((m) => ({ label: EXPORTS[m].label, toolCall: { name: 'export_csv', args: { modules: m } } }));
  if (readable.length > 1) buttons.push({ label: 'All of them', toolCall: { name: 'export_csv', args: { modules: 'all' } } });
  const text = readable.length === 1 ? `You can download the **${EXPORTS[readable[0]].label}** CSV.` : 'You can download these as CSV. Which ones do you want?';
  return {
    text: notes.length ? `${notes.join(' ')}\n${text}` : text,
    table: {
      columns: [
        { key: 'export', title: 'Export' },
        { key: 'columns', title: 'Columns' },
      ],
      rows: readable.map((m) => ({ export: EXPORTS[m].label, columns: columnsText(m) })),
    },
    buttons,
  };
}

// The model sometimes sends a list, numbers, nulls or the string "null"; everything is read as optional text.
const words = (description: string) =>
  z
    .preprocess(
      (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').join(', ') || undefined : isBlank(v) ? undefined : typeof v === 'string' ? v : String(v)),
      z.string().optional()
    )
    .describe(description);

// No example values: in testing the model copied them into unrelated requests.
const exportInput = z.object({
  modules: words('The data the user asked for, copied from their message'),
  filter: words('Only when the user wants some of the rows: their words for it'),
});

const exportCsv: AiTool<z.infer<typeof exportInput>> = {
  name: 'export_csv',
  label: 'Preparing the files',
  kind: 'read',
  description: 'Download CSV files of employees, documents, projects or tasks: one, several or all of them. Use for any request to download, export or get this data.',
  input: exportInput,
  async run(args, api, ctx) {
    // Chips and buttons carry the server's own words. Otherwise the user's words win, and the
    // model's count only where the user backs them ("the same again", a typo).
    const asked = readRequest(str(args.modules) ?? '');
    const said = ctx.fromButton ? asked : readRequest(ctx.latestText);
    const request = ctx.fromButton || said.named ? said : backedByUser(asked, ctx.userText);
    // The latest message must ask for files: a reply such as "thank you for making my work easy"
    // once made the model repeat the earlier modules, which the conversation still backed.
    const wanted = ctx.fromButton || asksForExport(ctx.latestText);
    if (!wanted && !said.named) return { text: 'Nothing to download. Say which data you want, for example "Download employees and projects".' };
    const readable = await readableExports(api);
    const notes: string[] = ctx.fromButton ? [] : elsewhereNotes(ctx.latestText, ctx.user.role === 'ORG_ADMIN');
    if (!request.modules.length) return choices(readable, notes);

    const allowed = request.modules.filter((m) => readable.includes(m));
    const refused = request.modules.filter((m) => !readable.includes(m));
    if (!allowed.length) {
      const text = request.everything
        ? "Your role can't read any of the data that can be exported here."
        : `You can't export ${labels(refused)}: your role can't read ${andList(refused)}.`;
      return { text: withNotes(text, notes) };
    }

    const warnings: string[] = [];
    if (refused.length && request.everything) notes.push(`${labels(refused)} ${refused.length === 1 ? 'is' : 'are'} left out: your role can't read ${refused.length === 1 ? 'it' : 'them'}.`);
    else if (refused.length) warnings.push(`You can't export ${labels(refused)}: your role can't read ${andList(refused)}.`);
    if (!ctx.fromButton) {
      const format = formatNote(ctx.latestText);
      if (format) notes.push(format);
      const filter = str(args.filter);
      if ((filter && grounded(filter, ctx.latestText)) || asksForFilter(ctx.latestText)) {
        notes.push(
          allowed.length === 1
            ? `The CSV has every ${EXPORTS[allowed[0]].noun}: exports can't be filtered here, but you can filter it in Excel or Google Sheets.`
            : "The files have every record: exports can't be filtered here, but you can filter them in Excel or Google Sheets."
        );
      }
    }

    const one = allowed.length === 1 ? allowed[0] : null;
    const text = one ? `**${EXPORTS[one].label}** CSV: the ${andList(EXPORTS[one].columns)} of every ${EXPORTS[one].noun}.` : `**${allowed.length} CSV files**: ${labels(allowed)}.`;
    return {
      text: withNotes(text, notes),
      warnings: warnings.length ? warnings : undefined,
      downloads: allowed.map(download),
      // A request downloads the files; a question about an export ("What's in the tasks CSV?"), or data
      // only named in passing ("projects are important to me"), just offers them.
      autoDownload: ctx.fromButton || (wanted && !isQuestion(ctx.latestText)),
    };
  },
};

export const exportsModule: AiModule = {
  key: 'exports',
  title: 'Exports assistant',
  intro: () => 'Say which data to download, e.g. "Employees and projects". The CSV files download straight away.',
  requiredPermission: { module: 'exports', action: 'read' },
  starters: [
    { label: 'Download everything', toolCall: { name: 'export_csv', args: { modules: 'all' } } },
    { label: 'What can I export?', toolCall: { name: 'export_csv', args: {} } },
  ],
  systemPrompt: (ctx) => `${basePrompt(ctx, 'exports')}
You are the Exports assistant. You download the organization's records as CSV files: employees, documents, projects and tasks.
- Call export_csv for every request to download or export data, also when the user writes in Hindi or Hinglish.
- Copy the data the user named into modules, in their own words.
- If the user wants only some of the rows, copy those words into filter.
- Never say that a file was downloaded. The app downloads it and shows that.`,
  tools: [exportCsv],
  // "Download employees and projects" needs no model: section 6.
  direct: (message) => (plainRequest(message) ? { name: 'export_csv', args: { modules: message } } : null),
};
