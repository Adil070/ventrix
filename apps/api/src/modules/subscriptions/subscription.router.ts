import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { z } from 'zod';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req: Request, res: Response) => {
  const subscription = await prisma.subscription.findFirst({ where: { organizationId: req.organizationId! } });
  res.json(successResponse(subscription));
});

const UpgradeSchema = z.object({ plan: z.enum(['BASIC', 'PREMIUM', 'ENTERPRISE']) });

router.post('/upgrade', async (req: Request, res: Response) => {
  const { plan } = UpgradeSchema.parse(req.body);
  const subscription = await prisma.subscription.upsert({
    where: { organizationId: req.organizationId! },
    update: { plan: plan as any, status: 'ACTIVE', currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
    create: { organizationId: req.organizationId!, plan: plan as any, status: 'ACTIVE', currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
  });
  res.json(successResponse(subscription, `Upgraded to ${plan} plan`));
});

router.post('/cancel', async (req: Request, res: Response) => {
  await prisma.subscription.update({ where: { organizationId: req.organizationId! }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelAtPeriodEnd: true } });
  res.json(successResponse({ message: 'Subscription cancelled' }));
});

export { router as subscriptionRouter };
