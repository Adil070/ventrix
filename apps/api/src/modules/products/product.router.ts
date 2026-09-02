import { Router } from 'express';
import { productController } from './product.controller';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { 
  getProductBarcode, 
  getProductQRCode, 
  bulkGenerateBarcodes 
} from './barcode.controller';

const router = Router();
router.use(authMiddleware, tenantMiddleware);
router.get('/', productController.list);
router.post('/', productController.create);
router.get('/low-stock', productController.getLowStock);
router.get('/categories', productController.listCategories);
router.post('/categories', productController.createCategory);
router.get('/units', productController.listUnits);
router.post('/units', productController.createUnit);
router.get('/brands', productController.listBrands);
router.post('/brands', productController.createBrand);

// Barcode & QR Code routes
router.post('/barcodes/bulk', bulkGenerateBarcodes);
router.get('/:id/barcode', getProductBarcode);
router.get('/:id/qrcode', getProductQRCode);

router.get('/:id', productController.getById);
router.put('/:id', productController.update);
router.patch('/:id', productController.update);
router.delete('/:id', productController.delete);
router.get('/:id/stock-history', productController.getStockHistory);
export { router as productRouter };
