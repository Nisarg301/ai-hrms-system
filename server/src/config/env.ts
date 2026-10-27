import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// An empty `KEY=` line (as copied from .env.example) means "not set", not "invalid".
const optionalString = z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional());
// z.coerce.boolean() would read the string "false" as true, so flags are parsed explicitly.
const flag = (fallback: boolean) => z.preprocess((value) => (value === undefined || value === '' ? fallback : value === 'true'), z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  // Public origin of this API, used to build absolute URLs (e.g. avatar links) in responses.
  API_BASE_URL: z.string().default('http://localhost:4000'),
  // Razorpay key id / secret. Backend only. Optional so tests and dev boot without
  // them; the payment endpoints answer 503 when they're missing.
  RAZOR_PAY_API_KEY: optionalString,
  RAZOR_PAY_SECRET: optionalString,
  // Email. No SMTP_HOST in development -> a throwaway Ethereal inbox (preview links
  // in the console); set these to use Mailtrap or a real provider. Never sends in test.
  SMTP_HOST: optionalString,
  SMTP_PORT: z.preprocess((value) => (value === '' ? undefined : value), z.coerce.number().int().positive().optional()),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  MAIL_FROM: z.string().default('Sentinel <no-reply@sentinel.local>'),
  SUPERADMIN_EMAIL: z.string().email().optional(),
  SUPERADMIN_PASSWORD: z.string().min(8).optional(),
  SUPERADMIN_NAME: z.string().min(1).optional(),
  // AI assistant (local Ollama, see docs/AI_ASSISTANT_PLAN.md). Off by default, so tests
  // and machines without Ollama boot normally; the /ai routes answer 503 while it's off.
  AI_ENABLED: flag(false),
  OLLAMA_HOST: z.string().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('qwen2.5:3b'),
  // Where tools send their internal API calls. Unset -> http://127.0.0.1:${PORT}/api/v1.
  AI_INTERNAL_API_BASE: optionalString,
  AI_MAX_TOOL_STEPS: z.coerce.number().int().min(1).default(4),
  AI_MAX_CONCURRENT: z.coerce.number().int().min(1).default(1),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  AI_NUM_CTX: z.coerce.number().int().positive().default(4096),
  // Read tools answer with their formatted table, without a second model call.
  AI_FAST_READS: flag(true),
  AI_HISTORY_DAYS: z.coerce.number().int().min(1).default(30),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
