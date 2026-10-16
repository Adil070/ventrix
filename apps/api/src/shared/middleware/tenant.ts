import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../infrastructure/database';
import { ForbiddenError, UnauthorizedError } from '../errors';

// Membership checks run on every request, so confirmed memberships are cached briefly: a removed member
// loses access within MEMBERSHIP_TTL_MS instead of keeping it until their token expires. "Not a member" is
// never cached, so someone who has just been added gets access straight away.
const MEMBERSHIP_TTL_MS = 60_000;
const membershipCache = new Map<string, number>(); // key -> expiry time

async function isActiveMember(userId: string, organizationId: string): Promise<boolean> {
  const key = `${userId}:${organizationId}`;
  if ((membershipCache.get(key) ?? 0) > Date.now()) return true;
  const membership = await prisma.userOrganization.findFirst({
    where: { userId, organizationId, isActive: true },
    select: { id: true },
  });
  if (membership) membershipCache.set(key, Date.now() + MEMBERSHIP_TTL_MS);
  else membershipCache.delete(key);
  return !!membership;
}

// Lets a user pick an organization with the X-Organization-ID header, but only one they actively belong to.
// Without this check any signed-in user could read or change another business's data by editing the header.
export async function tenantMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.user) return next();

  const orgId = (req.headers['x-organization-id'] as string | undefined) || req.user.organizationId;
  if (!orgId) return next();

  if (!req.user.isSuperAdmin && !(await isActiveMember(req.user.userId, orgId))) {
    throw new ForbiddenError('You do not have access to this organization');
  }

  req.organizationId = orgId;
  next();
}

export function requireTenant(req: Request, _res: Response, next: NextFunction): void {
  if (!req.organizationId) {
    throw new UnauthorizedError('Organization context required');
  }
  next();
}
