import { API_BASE_URL, notifyPlanExpired, refreshAccessToken } from '../api';
import { callApiServices } from '../callApiServices';
import { getAccessToken } from '../tokenStore';
import { ApiError } from '../../types/api';
import type {
  AiChatRequest,
  AiConfirmResult,
  AiConversation,
  AiConversationSummary,
  AiFormValues,
  AiModuleInfo,
  AiStreamEvent,
} from '../../types/ai';

export function listAiModulesRequest() {
  return callApiServices<AiModuleInfo[]>('/ai/modules', 'get', true);
}

export function listAiConversationsRequest(module: string) {
  return callApiServices<AiConversationSummary[]>('/ai/conversations', 'get', true, { module });
}

export function getAiConversationRequest(id: string) {
  return callApiServices<AiConversation>(`/ai/conversations/${id}`, 'get', true);
}

/** Confirm a card. With a file (a document upload), as multipart: the file plus the edited values as JSON text. */
export function confirmAiActionRequest(actionId: string, values?: AiFormValues, file?: File) {
  if (file) {
    const form = new FormData();
    if (values) form.append('values', JSON.stringify(values));
    form.append('file', file);
    return callApiServices<AiConfirmResult>(`/ai/actions/${actionId}/confirm`, 'post', true, form);
  }
  return callApiServices<AiConfirmResult>(`/ai/actions/${actionId}/confirm`, 'post', true, values ? { values } : {});
}

export function cancelAiActionRequest(actionId: string) {
  return callApiServices<Pick<AiConfirmResult, 'message' | 'action'>>(`/ai/actions/${actionId}/cancel`, 'post', true, {});
}

/**
 * Splits server-sent events off the front of `buffer`. Returns the complete events and
 * whatever is left of an event still arriving. Comment lines (": ping") are skipped.
 */
export function parseSse(buffer: string): { events: AiStreamEvent[]; rest: string } {
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: AiStreamEvent[] = [];
  for (const block of blocks) {
    let type = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) continue;
    try {
      events.push({ type, ...JSON.parse(data.join('\n')) } as AiStreamEvent);
    } catch {
      // A malformed event is skipped rather than breaking the whole answer.
    }
  }
  return { events, rest };
}

/**
 * POST /ai/chat, read as a stream. Uses fetch because axios can't stream in the browser,
 * so the token refresh and plan-expiry handling of the axios interceptor are done here.
 */
export async function streamAiChat(body: AiChatRequest, onEvent: (event: AiStreamEvent) => void, signal: AbortSignal): Promise<void> {
  const send = (token: string | null) =>
    fetch(`${API_BASE_URL}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      credentials: 'include',
      signal,
    });
  let res = await send(getAccessToken());
  if (res.status === 401) res = await send(await refreshAccessToken());
  if (!res.ok || !res.body) {
    if (res.status === 402) notifyPlanExpired();
    const json = (await res.json().catch(() => null)) as { error?: { message?: string; details?: unknown } } | null;
    throw new ApiError(res.status, json?.error?.message ?? 'The assistant is not available', json?.error?.details);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSse(buffer);
    buffer = parsed.rest;
    parsed.events.forEach(onEvent);
  }
  parseSse(`${buffer}\n\n`).events.forEach(onEvent);
}
