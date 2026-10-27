import rateLimit, { Options } from 'express-rate-limit';
import { errorResponseBody } from '../utils/apiResponse';

export function createRateLimiter(windowMs: number, max: number, keyGenerator?: Options['keyGenerator']): ReturnType<typeof rateLimit> {
  const handler: Options['handler'] = (_req, res) => {
    res.status(429).json(errorResponseBody('Too many requests, please try again later'));
  };
  return rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, handler, ...(keyGenerator ? { keyGenerator } : {}) });
}

export const authRateLimiter = createRateLimiter(15 * 60 * 1000, 10);

// Per signed-in user (mounted after authenticate), not per IP: an office shares one IP.
export const aiRateLimiter = createRateLimiter(60 * 1000, 20, (req) => req.user?.id ?? req.ip ?? 'anonymous');
