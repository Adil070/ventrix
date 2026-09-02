import { Router } from 'express';
import { inventoryController } from './inventory.controller';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';

const router = Router();
router.use(authMiddleware, tenantMiddleware);
router.get('/summary', inventoryController.getStockSummary);
router.get('/valuation', inventoryController.getValuation);
router.get('/movements', inventoryController.getMovements);
router.post('/adjust', inventoryController.adjustStock);
router.post('/adjustments', inventoryController.adjustStock);
router.post('/transfer', inventoryController.transferStock);
export { router as inventoryRouter };
