import { useCallback, useState } from 'react';
import { callApiServices } from '../../services/callApiServices';
import { ApiError } from '../../types/api';
import type { AiDownload } from '../../types/ai';
import { filenameFromDisposition, saveBlob } from '../../utils/saveBlob';

export type AiDownloadState = { status: 'busy' | 'done' } | { status: 'error'; error: string };

// Whatever an answer says, the assistant only hands the browser files from the export endpoints
// (the expenses one with its date range, as the Claims tab's button sends it) and from a
// document's own file (as the Documents page's Download button does).
const ALLOWED_PATH = /^\/exports\/[a-z-]+$|^\/exports\/expenses\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$|^\/documents\/[0-9a-f]{24}\/file$/;

/** The pages' own fallbacks when the response names no file: employees-2026-10-19.csv, or "document". */
const fallbackName = (path: string) => (path.startsWith('/documents/') ? 'document' : `${path.split('?')[0].split('/').pop()}-${new Date().toISOString().slice(0, 10)}.csv`);

/**
 * Files offered by the assistant: each is fetched with the user's token, exactly like the
 * page's CSV buttons, and saved under the name the server gives. Keyed by path.
 */
export function useAiDownloads() {
  const [states, setStates] = useState<Record<string, AiDownloadState>>({});
  const mark = useCallback((path: string, state: AiDownloadState) => setStates((s) => ({ ...s, [path]: state })), []);

  const download = useCallback(
    async (file: AiDownload) => {
      if (!ALLOWED_PATH.test(file.path)) {
        mark(file.path, { status: 'error', error: "This file can't be downloaded here." });
        return;
      }
      mark(file.path, { status: 'busy' });
      try {
        const response = await callApiServices<Blob>(file.path, 'get', true, undefined, 'blob');
        saveBlob(response.data, filenameFromDisposition(response.headers['content-disposition'], fallbackName(file.path)));
        mark(file.path, { status: 'done' });
      } catch (err) {
        // With a blob response the server's JSON error body isn't readable, so map the status.
        const error =
          err instanceof ApiError && err.status === 403 ? `You don't have permission to download the ${file.label}.` : `Could not download the ${file.label}. Please try again.`;
        mark(file.path, { status: 'error', error });
      }
    },
    [mark]
  );

  /** One after another: browsers handle a queue of downloads better than a burst. */
  const downloadAll = useCallback(
    async (files: AiDownload[]) => {
      for (const file of files) await download(file);
    },
    [download]
  );

  return { states, download, downloadAll };
}
