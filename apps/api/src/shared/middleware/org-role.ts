import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { prisma } from '../../infrastructure/database';
import { ForbiddenError } from '../errors';

/** Allows the request only if the caller holds one of `roles` in the selected organization (super admins always pass). */
export function requireOrgRole(...roles: UserRole[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (req.user?.isSuperAdmin) return next();
    const membership = await prisma.userOrganization.findFirst({
      where: { userId: req.userId!, organizationId: req.organizationId!, isActive: true },
      select: { role: true },
    });
    if (!membership || !roles.includes(membership.role)) {
      throw new ForbiddenError('Only the business owner or an admin can change this');
    }
    next();
  };
}
