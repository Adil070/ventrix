import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from '../errors';

export function tenantMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const orgId = req.headers['x-organization-id'] as string;

  if (orgId && req.user) {
    req.organizationId = orgId;
  }

  next();
}

export function requireTenant(req: Request, _res: Response, next: NextFunction): void {
  if (!req.organizationId) {
    throw new UnauthorizedError('Organization context required');
  }
  next();
}
