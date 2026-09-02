import { Router } from 'express';
import { customerController } from './customer.controller';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';

const router = Router();

router.use(authMiddleware, tenantMiddleware);

/**
 * @swagger
 * /api/customers:
 *   get:
 *     tags: [Customers]
 *     summary: List customers
 *     security: [{ bearerAuth: [] }]
 *   post:
 *     tags: [Customers]
 *     summary: Create customer
 *     security: [{ bearerAuth: [] }]
 */
router.get('/', customerController.list);
router.post('/', customerController.create);
router.get('/:id', customerController.getById);
router.put('/:id', customerController.update);
router.patch('/:id', customerController.update);
router.delete('/:id', customerController.delete);
router.get('/:id/ledger', customerController.getLedger);
router.get('/:id/statement', customerController.getStatement);

export { router as customerRouter };
