import { Router } from 'express';
import { supplierController } from './supplier.controller';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';

const router = Router();
router.use(authMiddleware, tenantMiddleware);
router.get('/', supplierController.list);
router.post('/', supplierController.create);
router.get('/:id', supplierController.getById);
router.put('/:id', supplierController.update);
router.delete('/:id', supplierController.delete);
router.get('/:id/ledger', supplierController.getLedger);
export { router as supplierRouter };
