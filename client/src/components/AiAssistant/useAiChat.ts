import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelAiActionRequest,
  confirmAiActionRequest,
  getAiConversationRequest,
  listAiConversationsRequest,
  streamAiChat,
} from '../../services/endpoints/ai.endpoints';
import { ApiError, type ValidationDetails } from '../../types/api';
import type { AiAction, AiChatMessage, AiChatRequest, AiDownload, AiFormValues, AiStreamEvent, AiToolCallRef } from '../../types/ai';

/** The answer being worked on: shown as a progress bubble until the final message arrives. */
export interface PendingReply {
  startedAt: number;
  state: 'sending' | 'thinking' | 'queued';
  ahead?: number;
  tool?: string;
  text: string;
}

export interface ConfirmOutcome {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

function fieldErrorsOf(err: ApiError): Record<string, string> | undefined {
  const fields = (err.details as ValidationDetails | undefined)?.fieldErrors;
  if (!fields) return undefined;
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v[0]]));
}

/**
 * One assistant conversation: sending messages and button clicks, the streamed progress,
 * and Confirm/Cancel on cards. `onChanged` runs after a confirmed change, so the page
 * behind the drawer can reload its data; `onDownloads` gets the files a live answer offers,
 * `onView` the page a live answer moves to (the Expenses tabs and their filters), and `onGoTo`
 * the page a live answer opens ("Go to projects"). `page` is sent with each message.
 */
export function useAiChat(
  module: string,
  opts: {
    onChanged?: () => void;
    onSecret?: (secret: { label: string; value: string }) => void;
    onDownloads?: (files: AiDownload[]) => void;
    onView?: (path: string) => void;
    onGoTo?: (path: string) => void;
    page?: string;
  } = {}
) {
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [pending, setPending] = useState<PendingReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => () => abortRef.current?.abort(), []);

  /** The latest conversation for this module, once, when the drawer first opens. */
  const loadHistory = useCallback(async () => {
    if (historyLoaded) return;
    setHistoryLoaded(true);
    try {
      const { data } = await listAiConversationsRequest(module);
      if (!data[0]) return;
      const { data: conversation } = await getAiConversationRequest(data[0].id);
      setConversationId(conversation.id);
      setMessages(conversation.messages);
    } catch {
      // No history is fine: the chat simply starts empty.
    }
  }, [historyLoaded, module]);

  /**
   * Sends one request to the server (POST /ai/chat) and follows the answer while it streams in.
   * Typed and spoken messages (`send`) and chip or button clicks (`runToolCall`) all come here.
   *
   * 1. Stops a request still running, so only the latest one is followed.
   * 2. Shows the user's own words at once (`shownAs`), and a progress bubble (`pending`).
   * 3. Turns each server event into what the drawer shows:
   *    - `status`: thinking, or queued behind others;
   *    - `tool`: what it is doing ("Preparing the new project");
   *    - `token`: text as it is written;
   *    - `message`: the finished answer or confirm card;
   *    - `done`: the conversation id, so the next message continues this conversation;
   *    - `error`: a message to show.
   * 4. Clears the progress bubble at the end, unless a newer request has taken over.
   */
  const stream = useCallback(
    async (request: Omit<AiChatRequest, 'module' | 'conversationId'>, shownAs: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setMessages((m) => [...m, { role: 'user', text: shownAs, result: null, action: null, createdAt: new Date().toISOString() }]);
      setPending({ startedAt: Date.now(), state: 'sending', text: '' });
      let goTo: string | undefined;
      const onEvent = (event: AiStreamEvent) => {
        switch (event.type) {
          case 'status':
            setPending((p) => (p ? { ...p, state: event.state, ahead: event.ahead } : p));
            break;
          case 'tool':
            setPending((p) => (p ? { ...p, tool: event.label } : p));
            break;
          case 'token':
            setPending((p) => (p ? { ...p, text: p.text + event.text } : p));
            break;
          case 'message': {
            setMessages((m) => [...m, { ...event.message, live: true }]);
            setPending((p) => (p ? { ...p, text: '' } : p));
            // Only a live answer starts its downloads; one loaded from history never does.
            const result = event.message.result;
            if (result?.autoDownload && result.downloads?.length) optsRef.current.onDownloads?.(result.downloads);
            if (result?.view) optsRef.current.onView?.(result.view);
            if (result?.goTo) goTo = result.goTo;
            break;
          }
          case 'done':
            setConversationId(event.conversationId);
            break;
          case 'error':
            setError(event.message);
            break;
        }
      };
      try {
        await streamAiChat({ module, conversationId, page: optsRef.current.page, ...request }, onEvent, controller.signal);
        // Only once the server has saved the turn: leaving the page closes this drawer and its request.
        if (goTo && !controller.signal.aborted) optsRef.current.onGoTo?.(goTo);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof ApiError ? err.message : 'The assistant could not be reached.');
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setPending(null);
        }
      }
    },
    [module, conversationId]
  );

  const send = useCallback((text: string) => {
    const message = text.trim();
    if (message) void stream({ message }, message);
  }, [stream]);

  /** A starter chip or a button in an answer: runs the tool directly, without the model. */
  const runToolCall = useCallback((toolCall: AiToolCallRef, label: string) => void stream({ toolCall: { ...toolCall, label } }, label), [stream]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(null);
  }, []);

  const replaceAction = (action: AiAction) =>
    setMessages((m) => m.map((msg) => (msg.action?.id === action.id ? { ...msg, action } : msg)));

  const confirm = useCallback(async (actionId: string, values?: AiFormValues, file?: File): Promise<ConfirmOutcome> => {
    try {
      const { data } = await confirmAiActionRequest(actionId, values, file);
      replaceAction(data.action);
      setMessages((m) => [...m, data.message]);
      data.secrets.forEach((s) => optsRef.current.onSecret?.(s));
      optsRef.current.onChanged?.();
      if (data.message.result?.view) optsRef.current.onView?.(data.message.result.view);
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError) return { ok: false, error: err.message, fieldErrors: fieldErrorsOf(err) };
      return { ok: false, error: 'Something went wrong. Nothing was changed.' };
    }
  }, []);

  const cancel = useCallback(async (actionId: string) => {
    try {
      const { data } = await cancelAiActionRequest(actionId);
      replaceAction(data.action);
      setMessages((m) => [...m, data.message]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel.');
    }
  }, []);

  const newChat = useCallback(() => {
    stop();
    setConversationId(undefined);
    setMessages([]);
    setError(null);
  }, [stop]);

  return { messages, pending, error, loadHistory, send, runToolCall, stop, confirm, cancel, newChat };
}
