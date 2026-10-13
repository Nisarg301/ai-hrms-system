import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// An empty `KEY=` line (as copied from .env.example) means "not set", not "invalid".
const optionalString = z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional());

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
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
