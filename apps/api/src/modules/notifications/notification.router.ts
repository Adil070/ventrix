import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

router.get('/', async (req: Request, res: Response) => {
  const { page = 1, limit = 20, isRead } = req.query as any;
  const where: any = {
    userId: req.userId!,
    organizationId: req.organizationId!,
    ...(isRead !== undefined && { isRead: isRead === 'true' }),
  };
  const [data, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, skip: (+page - 1) * +limit, take: +limit, orderBy: { createdAt: 'desc' } }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: req.userId!, organizationId: req.organizationId!, isRead: false } }),
  ]);
  res.json(successResponse({ notifications: data, unreadCount, total }));
});

router.post('/:id/read', async (req: Request, res: Response) => {
  await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true, readAt: new Date() } });
  res.json(successResponse({ message: 'Marked as read' }));
});

router.post('/read-all', async (req: Request, res: Response) => {
  await prisma.notification.updateMany({ where: { userId: req.userId!, organizationId: req.organizationId!, isRead: false }, data: { isRead: true, readAt: new Date() } });
  res.json(successResponse({ message: 'All notifications marked as read' }));
});

router.delete('/:id', async (req: Request, res: Response) => {
  await prisma.notification.delete({ where: { id: req.params.id } });
  res.json(successResponse({ message: 'Notification deleted' }));
});

export { router as notificationRouter };
