import rateLimit from 'express-rate-limit';
import { config } from '../../config';
import { TooManyRequestsError } from '../errors';

export const rateLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.user?.userId || req.ip || 'unknown';
  },
  handler: (_req, _res, next) => {
    next(new TooManyRequestsError('Too many requests. Please try again later.'));
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 auth attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
  handler: (_req, _res, next) => {
    next(new TooManyRequestsError('Too many authentication attempts. Please try again in 15 minutes.'));
  },
});

export const otpRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new TooManyRequestsError('Too many OTP requests. Please try again in 5 minutes.'));
  },
});
