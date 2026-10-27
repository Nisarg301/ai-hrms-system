import { env } from '../config/env';

// A thin client for Ollama's HTTP API (https://github.com/ollama/ollama/blob/main/docs/api.md).
// Plain fetch keeps it dependency-free and easy to replace with a scripted model in tests.

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
}

export interface ModelTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ModelToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ModelReply {
  content: string;
  toolCalls: ModelToolCall[];
}

export interface ModelClient {
  chat(request: { messages: ModelMessage[]; tools: ModelTool[]; onToken?: (text: string) => void; signal?: AbortSignal }): Promise<ModelReply>;
}

/** Ollama is down, the model is missing, or the call timed out. */
export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelUnavailableError';
  }
}

const KEEP_ALIVE = '30m';

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(env.AI_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${env.OLLAMA_HOST}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let message = text;
      try {
        message = JSON.parse(text).error ?? text;
      } catch {
        // not JSON: keep the text
      }
      throw new ModelUnavailableError(`Ollama answered ${res.status}: ${message || res.statusText}`);
    }
    return res;
  } catch (err) {
    if (err instanceof ModelUnavailableError || signal?.aborted) throw err;
    if (timeout.aborted) throw new ModelUnavailableError('The assistant took too long to answer.');
    throw new ModelUnavailableError(`Cannot reach Ollama at ${env.OLLAMA_HOST}.`);
  }
}

export const ollamaClient: ModelClient & {
  health(): Promise<{ up: boolean; modelAvailable: boolean; models: string[] }>;
  warmUp(): Promise<void>;
} = {
  async chat({ messages, tools, onToken, signal }) {
    const res = await post(
      '/api/chat',
      {
        model: env.OLLAMA_MODEL,
        messages,
        tools,
        stream: true,
        keep_alive: KEEP_ALIVE,
        options: { temperature: 0.1, num_ctx: env.AI_NUM_CTX },
      },
      signal
    );
    // The stream is NDJSON: one JSON object per line.
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    let content = '';
    const toolCalls: ModelToolCall[] = [];
    const handle = (line: string) => {
      if (!line.trim()) return;
      const chunk = JSON.parse(line) as { message?: { content?: string; tool_calls?: { function: { name: string; arguments: unknown } }[] }; error?: string };
      if (chunk.error) throw new ModelUnavailableError(chunk.error);
      const piece = chunk.message?.content ?? '';
      if (piece) {
        content += piece;
        onToken?.(piece);
      }
      for (const call of chunk.message?.tool_calls ?? []) {
        toolCalls.push({ name: call.function.name, args: parseArgs(call.function.arguments) });
      }
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        lines.forEach(handle);
      }
      handle(buffered);
    } catch (err) {
      if (err instanceof ModelUnavailableError || signal?.aborted) throw err;
      // The request timeout also cuts the body stream.
      throw new ModelUnavailableError('The assistant took too long to answer.');
    }
    return { content, toolCalls };
  },

  async health() {
    try {
      const res = await fetch(`${env.OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { up: false, modelAvailable: false, models: [] };
      const json = (await res.json()) as { models?: { name: string }[] };
      const models = (json.models ?? []).map((m) => m.name);
      const wanted = env.OLLAMA_MODEL.includes(':') ? env.OLLAMA_MODEL : `${env.OLLAMA_MODEL}:latest`;
      return { up: true, modelAvailable: models.includes(wanted), models };
    } catch {
      return { up: false, modelAvailable: false, models: [] };
    }
  },

  /** An empty chat loads the model into RAM, so the first real question doesn't pay for it. */
  async warmUp() {
    await post('/api/chat', { model: env.OLLAMA_MODEL, messages: [], keep_alive: KEEP_ALIVE, stream: false });
  },
};
