import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../../infrastructure/logger';
import { AppError } from '../errors';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Known application errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  // Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  // Prisma errors
  if (err.constructor.name === 'PrismaClientKnownRequestError') {
    const prismaErr = err as any;

    if (prismaErr.code === 'P2002') {
      res.status(409).json({
        success: false,
        message: 'A record with this data already exists',
        code: 'DUPLICATE_ENTRY',
        field: prismaErr.meta?.target,
      });
      return;
    }

    if (prismaErr.code === 'P2025') {
      res.status(404).json({
        success: false,
        message: 'Record not found',
        code: 'NOT_FOUND',
      });
      return;
    }
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    res.status(401).json({
      success: false,
      message: 'Invalid authentication token',
      code: 'INVALID_TOKEN',
    });
    return;
  }

  if (err.name === 'TokenExpiredError') {
    res.status(401).json({
      success: false,
      message: 'Authentication token expired',
      code: 'TOKEN_EXPIRED',
    });
    return;
  }

  // Unexpected errors
  logger.error(
    { err, url: req.url, method: req.method, ip: req.ip },
    'Unexpected server error'
  );

  res.status(500).json({
    success: false,
    message: 'An unexpected error occurred',
    code: 'INTERNAL_SERVER_ERROR',
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack,
      original: err.message,
    }),
  });
}
