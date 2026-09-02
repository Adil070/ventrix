import { Router } from 'express';
import { paymentController } from './payment.controller';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';

const router = Router();
router.use(authMiddleware, tenantMiddleware);
router.get('/', paymentController.list);
router.post('/', paymentController.create);
router.get('/:id', paymentController.getById);
export { router as paymentRouter };
