import rateLimit from 'express-rate-limit';
import { Request } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { TooManyRequestsError } from '../errors';

/**
 * Signed-in requests are counted per user, others per IP. This limiter runs before authMiddleware
 * (req.user is not set yet), so the user comes from the access token itself; verifying the signature stops a
 * forged token from picking its own bucket. Staff sharing one shop connection no longer share one budget.
 */
function rateLimitKey(req: Request): string {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), config.JWT_SECRET) as { userId?: string };
      if (payload.userId) return `user:${payload.userId}`;
    } catch {
      // expired or invalid token: fall back to the IP
    }
  }
  return `ip:${req.ip || 'unknown'}`;
}

export const rateLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
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
