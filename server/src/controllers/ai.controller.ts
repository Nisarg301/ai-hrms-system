import { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { AiEvent, cancelAction, confirmAction, conversationView, runTurn } from '../ai/agent.service';
import { ollamaClient } from '../ai/ollama.client';
import { allowedTools, canUseModule, getModule, usableModules } from '../ai/registry';
import { env } from '../config/env';
import { asyncHandler } from '../middlewares/asyncHandler';
import { AiConversationModel } from '../models/aiConversation.model';
import { ApiError, successResponse } from '../utils/apiResponse';
import { conversationsQuerySchema } from '../validators/ai.validators';

const PING_MS = 15_000;

function bearer(req: Request): string {
  return (req.headers.authorization ?? '').slice('Bearer '.length);
}

/** 503 while AI_ENABLED is off, so the client simply hides the assistant. */
export function requireAiEnabled(_req: Request, _res: Response, next: NextFunction): void {
  if (!env.AI_ENABLED) {
    next(new ApiError(503, 'The AI assistant is turned off on this server', { code: 'AI_DISABLED' }));
    return;
  }
  next();
}

export const health = asyncHandler(async (_req: Request, res: Response) => {
  if (!env.AI_ENABLED) {
    res.status(200).json(successResponse({ enabled: false, ollama: 'down', model: env.OLLAMA_MODEL, modelAvailable: false }));
    return;
  }
  const status = await ollamaClient.health();
  res.status(200).json(successResponse({ enabled: true, ollama: status.up ? 'up' : 'down', model: env.OLLAMA_MODEL, modelAvailable: status.modelAvailable }));
});

/** The assistants this user may open, with the starter chips for their role. */
export const listModules = asyncHandler(async (req: Request, res: Response) => {
  const modules = await usableModules(req.user!, req.subscription);
  const data = [];
  for (const m of modules) {
    // A chip is only offered when the user may use the tool behind it.
    const tools = new Set((await allowedTools(m, req.user!)).map((t) => t.name));
    data.push({
      key: m.key,
      title: m.title,
      intro: m.intro(req.user!.role),
      starters: m.starters.filter((s) => tools.has(s.toolCall.name)),
    });
  }
  res.status(200).json(successResponse(data));
});

/** One chat turn, streamed as server-sent events (docs/AI_ASSISTANT_PLAN.md, 7.9). */
export const chat = asyncHandler(async (req: Request, res: Response) => {
  const module = getModule(req.body.module)!;
  if (!(await canUseModule(module, req.user!, req.subscription))) {
    throw new ApiError(403, 'This assistant is not available to you');
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // `res` closes when the browser goes away (Stop, or the drawer closed): abort the model call.
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);
  const emit = ({ type, ...data }: AiEvent) => {
    if (res.writableEnded) return;
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await runTurn({
      module,
      user: req.user!,
      token: bearer(req),
      conversationId: req.body.conversationId,
      message: req.body.message,
      toolCall: req.body.toolCall,
      page: req.body.page,
      subscription: req.subscription,
      emit,
      signal: controller.signal,
    });
  } finally {
    clearInterval(ping);
    if (!res.writableEnded) res.end();
  }
});

/**
 * A confirm with a file (an uploaded document) comes as multipart/form-data: the upload
 * middleware has checked the file, and the edited values, if any, arrive as JSON text.
 */
export function valuesFromMultipart(req: Request, _res: Response, next: NextFunction): void {
  if (req.is('multipart/form-data') && typeof req.body?.values === 'string') {
    try {
      req.body.values = JSON.parse(req.body.values);
    } catch {
      next(new ApiError(400, 'The edited values could not be read'));
      return;
    }
  }
  next();
}

export const confirm = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file ? { buffer: req.file.buffer, originalname: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size } : undefined;
  const result = await confirmAction({
    user: req.user!,
    subscription: req.subscription,
    token: bearer(req),
    actionId: req.params.id,
    values: req.body.values,
    file,
  });
  res.status(200).json(successResponse(result));
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json(successResponse(await cancelAction(req.user!, req.params.id)));
});

function owner(req: Request) {
  return { organizationId: new Types.ObjectId(req.user!.organizationId!), userId: new Types.ObjectId(req.user!.id) };
}

/** The user's own recent conversations (never anyone else's, admins included). */
export const listConversations = asyncHandler(async (req: Request, res: Response) => {
  const parsed = conversationsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());
  const filter = { ...owner(req), ...(parsed.data.module ? { module: parsed.data.module } : {}) };
  const conversations = await AiConversationModel.find(filter).select('module updatedAt messages').slice('messages', 1).sort({ updatedAt: -1 }).limit(20);
  res.status(200).json(
    successResponse(
      conversations.map((c) => ({ id: String(c._id), module: c.module, updatedAt: c.updatedAt, preview: c.messages[0]?.content.slice(0, 80) ?? '' }))
    )
  );
});

export const getConversation = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json(successResponse(await conversationView(req.user!, req.params.id)));
});

export const deleteConversation = asyncHandler(async (req: Request, res: Response) => {
  const { deletedCount } = await AiConversationModel.deleteOne({ _id: req.params.id, ...owner(req) });
  if (!deletedCount) throw new ApiError(404, 'Conversation not found');
  res.status(200).json(successResponse({ id: req.params.id, deleted: true }));
});
