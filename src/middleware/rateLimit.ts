/** HTTP rate limits: strict on login, looser on the rest of the API. */
import rateLimit from 'express-rate-limit';
import { config } from '../config';

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' } },
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down.' } },
});

export const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many send requests.' } },
});
