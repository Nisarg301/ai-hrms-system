import rateLimit, { Options } from 'express-rate-limit';
import { errorResponseBody } from '../utils/apiResponse';

export function createRateLimiter(windowMs: number, max: number): ReturnType<typeof rateLimit> {
  const handler: Options['handler'] = (_req, res) => {
    res.status(429).json(errorResponseBody('Too many requests, please try again later'));
  };
  return rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, handler });
}

export const authRateLimiter = createRateLimiter(15 * 60 * 1000, 10);
