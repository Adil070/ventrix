import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

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

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

router.post('/me/change-password', async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = ChangePasswordSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user?.passwordHash) return res.status(400).json({ error: 'No password set' });

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });

  const hash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: req.userId! }, data: { passwordHash: hash } });
  res.json(successResponse({ message: 'Password changed successfully' }));
});

// Organization members
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

  let user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email: input.email, firstName: '', lastName: '', passwordHash: await bcrypt.hash(Math.random().toString(36), 12) },
    });
  }

  const existing = await prisma.userOrganization.findFirst({ where: { userId: user.id, organizationId: req.organizationId! } });
  if (existing) return res.status(409).json({ error: 'User already a member' });

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
  const { role } = req.body;
  const membership = await prisma.userOrganization.update({
    where: { userId_organizationId: { userId: req.params.userId, organizationId: req.organizationId! } },
    data: { role: role as any },
  });
  res.json(successResponse(membership, 'Role updated'));
});

router.delete('/organization/members/:userId', tenantMiddleware, async (req: Request, res: Response) => {
  await prisma.userOrganization.update({
    where: { userId_organizationId: { userId: req.params.userId, organizationId: req.organizationId! } },
    data: { isActive: false },
  });
  res.json(successResponse({ message: 'Member removed' }));
});

// Sessions
router.get('/me/sessions', async (req: Request, res: Response) => {
  const sessions = await prisma.userSession.findMany({ where: { userId: req.userId!, isActive: true }, orderBy: { lastActiveAt: 'desc' } });
  res.json(successResponse(sessions));
});

router.delete('/me/sessions/:id', async (req: Request, res: Response) => {
  await prisma.userSession.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.json(successResponse({ message: 'Session terminated' }));
});

export { router as userRouter };
