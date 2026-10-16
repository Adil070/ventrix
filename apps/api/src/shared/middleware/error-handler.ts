import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../../infrastructure/logger';
import { Prisma } from '@prisma/client';
import { AppError } from '../errors';

// body-parser / multer / http-errors style errors carry a 4xx status of their own.
function clientStatus(err: any): number | undefined {
  const status = Number(err?.status ?? err?.statusCode);
  return status >= 400 && status < 500 ? status : undefined;
}

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

  // Malformed JSON body (rejected by express.json before any route runs)
  if ((err as any).type === 'entity.parse.failed') {
    res.status(400).json({
      success: false,
      message: 'Malformed JSON in request body',
      code: 'INVALID_JSON',
    });
    return;
  }

  // Upload errors (e.g. file too large)
  if (err.name === 'MulterError') {
    const tooLarge = (err as any).code === 'LIMIT_FILE_SIZE';
    res.status(tooLarge ? 413 : 400).json({
      success: false,
      message: err.message,
      code: tooLarge ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR',
    });
    return;
  }

  // Other body-parser / http errors with a client status (payload too large, bad encoding, ...)
  const status = clientStatus(err);
  if (status) {
    res.status(status).json({
      success: false,
      message: (err as any).expose === false ? 'Bad request' : err.message,
      code: 'BAD_REQUEST',
    });
    return;
  }

  // Prisma: a query built from bad input (wrong type, unknown enum value, ...)
  if (err instanceof Prisma.PrismaClientValidationError || err.constructor.name === 'PrismaClientValidationError') {
    res.status(400).json({
      success: false,
      message: 'Invalid request data',
      code: 'INVALID_DATA',
    });
    return;
  }

  // Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError || err.constructor.name === 'PrismaClientKnownRequestError') {
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

    if (prismaErr.code === 'P2003') {
      res.status(400).json({
        success: false,
        message: 'A referenced record does not exist',
        code: 'INVALID_REFERENCE',
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

  // Stack traces only ever leave the server in local development.
  res.status(500).json({
    success: false,
    message: 'An unexpected error occurred',
    code: 'INTERNAL_SERVER_ERROR',
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack, original: err.message } : {}),
  });
}
