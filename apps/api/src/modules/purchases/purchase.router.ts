import { Router } from 'express';
import { purchaseController } from './purchase.controller';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';

const router = Router();
router.use(authMiddleware, tenantMiddleware);
router.get('/', purchaseController.list);
router.post('/', purchaseController.create);
router.get('/:id', purchaseController.getById);
router.post('/:id/cancel', purchaseController.cancel);
export { router as purchaseRouter };
