import { Request, Response } from 'express';
import { inventoryService } from './inventory.service';
import { successResponse } from '../../shared/helpers/response.helper';
import { z } from 'zod';

const AdjustStockSchema = z.object({
  productId: z.string(),
  warehouseId: z.string().optional(),
  type: z.enum(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'OPENING_STOCK', 'DAMAGE', 'EXPIRED', 'RETURN_IN', 'RETURN_OUT']),
  quantity: z.number().positive(),
  unitCost: z.number().min(0).optional(),
  notes: z.string().optional(),
  referenceNumber: z.string().optional(),
});

const TransferStockSchema = z.object({
  productId: z.string(),
  fromWarehouseId: z.string(),
  toWarehouseId: z.string(),
  quantity: z.number().positive(),
  notes: z.string().optional(),
});

export class InventoryController {
  getStockSummary = async (req: Request, res: Response) => {
    const result = await inventoryService.getStockSummary(req.organizationId!, req.query.warehouseId as string);
    res.json(successResponse({ products: result }));
  };
  adjustStock = async (req: Request, res: Response) => {
    const input = AdjustStockSchema.parse(req.body);
    const result = await inventoryService.adjustStock(req.organizationId!, req.userId!, input);
    res.json(successResponse(result));
  };
  transferStock = async (req: Request, res: Response) => {
    const input = TransferStockSchema.parse(req.body);
    const result = await inventoryService.transferStock(req.organizationId!, req.userId!, input);
    res.json(successResponse(result));
  };
  getMovements = async (req: Request, res: Response) => {
    const query = { ...req.query, page: req.query.page ? +req.query.page : 1, limit: req.query.limit ? +req.query.limit : 20 } as any;
    const result = await inventoryService.getStockMovements(req.organizationId!, query);
    res.json(successResponse({ movements: result.data, total: result.meta.total, page: result.meta.page, totalPages: result.meta.totalPages }));
  };
  getValuation = async (req: Request, res: Response) => {
    const result = await inventoryService.getInventoryValuation(req.organizationId!);
    res.json(successResponse(result));
  };
}
export const inventoryController = new InventoryController();
