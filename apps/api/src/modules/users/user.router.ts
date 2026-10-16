import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { cache, CacheService } from '../../infrastructure/cache';

const router = Router();
router.use(authMiddleware);

// Current user profile
router.get('/me', async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { id: true, email: true, phone: true, firstName: true, lastName: true, avatarUrl: true, isEmailVerified: true, isPhoneVerified: true, createdAt: true, preferences: true,
      organizations: { include: { organization: { select: { id: true, name: true, logoUrl: true } }, permissions: true } } },
  });
  res.json(successResponse(user));
});

router.put('/me', async (req: Request, res: Response) => {
  const { firstName, lastName, phone, preferences } = req.body;
  const user = await prisma.user.update({
    where: { id: req.userId! },
    data: { firstName, lastName, phone, preferences },
    select: { id: true, email: true, firstName: true, lastName: true, phone: true, avatarUrl: true },
  });
  res.json(successResponse(user, 'Profile updated'));
});

// Same strength rule as sign-up and password reset.
const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message: 'Password must contain uppercase, lowercase, number and special character',
  }),
  // The caller's own refresh token, so this session stays signed in while all others are signed out.
  refreshToken: z.string().optional(),
});

router.post('/me/change-password', async (req: Request, res: Response) => {
  const { currentPassword, newPassword, refreshToken } = ChangePasswordSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user?.passwordHash) throw new BadRequestError('No password set');

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw new BadRequestError('Current password is incorrect');

  const hash = await bcrypt.hash(newPassword, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: req.userId! }, data: { passwordHash: hash } }),
    // Sign out every other device: a changed password must lock out anyone using the old one.
    prisma.refreshToken.updateMany({
      where: { userId: req.userId!, isRevoked: false, ...(refreshToken && { token: { not: refreshToken } }) },
      data: { isRevoked: true },
    }),
  ]);
  res.json(successResponse({ message: 'Password changed successfully' }));
});

// ─── Organization members ─────────────────────────────────────────────────────
// Roles live on UserOrganization (per organization). Only owners and admins of the selected organization
// manage members; only an owner can grant, change or remove the owner role; the last owner always stays.
const MANAGER_ROLES: UserRole[] = [UserRole.ORG_OWNER, UserRole.BRANCH_ADMIN];
const AssignableRole = z.nativeEnum(UserRole).refine((r) => r !== UserRole.SUPER_ADMIN, { message: 'Invalid role' });

async function callerRole(req: Request): Promise<UserRole> {
  if (req.user?.isSuperAdmin) return UserRole.ORG_OWNER;
  const me = await prisma.userOrganization.findFirst({
    where: { userId: req.userId!, organizationId: req.organizationId!, isActive: true },
    select: { role: true },
  });
  if (!me) throw new ForbiddenError('You are not a member of this organization');
  return me.role;
}

async function requireMemberManager(req: Request): Promise<UserRole> {
  const role = await callerRole(req);
  if (!MANAGER_ROLES.includes(role)) throw new ForbiddenError('Only organization owners and admins can manage members');
  return role;
}

async function findMemberOr404(req: Request) {
  const member = await prisma.userOrganization.findFirst({
    where: { userId: req.params.userId, organizationId: req.organizationId!, isActive: true },
  });
  if (!member) throw new NotFoundError('Member', req.params.userId);
  return member;
}

async function assertNotLastOwner(organizationId: string, userId: string) {
  const otherOwners = await prisma.userOrganization.count({
    where: { organizationId, role: UserRole.ORG_OWNER, isActive: true, userId: { not: userId } },
  });
  if (otherOwners === 0) throw new BadRequestError('An organization must keep at least one owner');
}

router.get('/organization/members', tenantMiddleware, async (req: Request, res: Response) => {
  const members = await prisma.userOrganization.findMany({
    where: { organizationId: req.organizationId! },
    include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true, isActive: true, lastLoginAt: true } }, permissions: true },
  });
  res.json(successResponse(members));
});

const InviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['BRANCH_ADMIN', 'ACCOUNTANT', 'MANAGER', 'SALES_EXECUTIVE', 'CASHIER', 'WAREHOUSE_MANAGER', 'STAFF']),
  branchId: z.string().optional(),
  permissions: z.array(z.object({ module: z.string(), permissions: z.array(z.string()) })).optional(),
});

router.post('/organization/members/invite', tenantMiddleware, async (req: Request, res: Response) => {
  const input = InviteMemberSchema.parse(req.body);
  await requireMemberManager(req);

  if (input.branchId) {
    const branch = await prisma.branch.findFirst({ where: { id: input.branchId, organizationId: req.organizationId! }, select: { id: true } });
    if (!branch) throw new BadRequestError('Branch not found in this organization');
  }

  let user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email: input.email, firstName: '', lastName: '', passwordHash: await bcrypt.hash(Math.random().toString(36), 12) },
    });
  }

  const existing = await prisma.userOrganization.findFirst({ where: { userId: user.id, organizationId: req.organizationId! } });
  if (existing?.isActive) throw new ConflictError('User already a member');
  if (existing) {
    // Re-inviting someone who was removed brings the old membership back with the new role.
    const membership = await prisma.userOrganization.update({
      where: { id: existing.id },
      data: { isActive: true, role: input.role as any, branchId: input.branchId ?? null },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } }, permissions: true },
    });
    return res.status(201).json(successResponse(membership, 'Member invited'));
  }

  const membership = await prisma.userOrganization.create({
    data: {
      userId: user.id, organizationId: req.organizationId!, role: input.role as any,
      branchId: input.branchId,
      permissions: input.permissions ? {
        create: input.permissions.map(p => ({ module: p.module, permissions: p.permissions as any[] })),
      } : undefined,
    },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true } }, permissions: true },
  });

  res.status(201).json(successResponse(membership, 'Member invited'));
});

router.put('/organization/members/:userId/role', tenantMiddleware, async (req: Request, res: Response) => {
  const { role } = z.object({ role: AssignableRole }).parse(req.body);
  const myRole = await requireMemberManager(req);
  const member = await findMemberOr404(req);

  const touchesOwner = member.role === UserRole.ORG_OWNER || role === UserRole.ORG_OWNER;
  if (touchesOwner && myRole !== UserRole.ORG_OWNER) {
    throw new ForbiddenError('Only an organization owner can grant or change the owner role');
  }
  if (member.role === UserRole.ORG_OWNER && role !== UserRole.ORG_OWNER) {
    await assertNotLastOwner(req.organizationId!, member.userId);
  }

  const membership = await prisma.userOrganization.update({ where: { id: member.id }, data: { role } });
  await cache.del(CacheService.keys.user(member.userId));
  res.json(successResponse(membership, 'Role updated'));
});

router.delete('/organization/members/:userId', tenantMiddleware, async (req: Request, res: Response) => {
  const myRole = await requireMemberManager(req);
  const member = await findMemberOr404(req);

  if (member.role === UserRole.ORG_OWNER) {
    if (myRole !== UserRole.ORG_OWNER) throw new ForbiddenError('Only an organization owner can remove an owner');
    await assertNotLastOwner(req.organizationId!, member.userId);
  }

  await prisma.userOrganization.update({ where: { id: member.id }, data: { isActive: false } });
  await cache.del(CacheService.keys.user(member.userId));
  res.json(successResponse({ message: 'Member removed' }));
});

// Sessions
router.get('/me/sessions', async (req: Request, res: Response) => {
  const sessions = await prisma.userSession.findMany({ where: { userId: req.userId!, isActive: true }, orderBy: { lastActiveAt: 'desc' } });
  res.json(successResponse(sessions));
});

router.delete('/me/sessions/:id', async (req: Request, res: Response) => {
  const { count } = await prisma.userSession.updateMany({ where: { id: req.params.id, userId: req.userId! }, data: { isActive: false } });
  if (!count) throw new NotFoundError('Session', req.params.id);
  res.json(successResponse({ message: 'Session terminated' }));
});

export { router as userRouter };
