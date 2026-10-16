import { Request, Response } from 'express';
import { inventoryService } from './inventory.service';
import { successResponse } from '../../shared/helpers/response.helper';
import { z } from 'zod';
import { StockMovementType } from '@prisma/client';

// Manual adjustments only. All are valid StockMovementType values; system movements (SALE, PURCHASE,
// SALE_RETURN, PURCHASE_RETURN, TRANSFER_*, PRODUCTION_*) are written by their own modules.
const ADJUSTMENT_TYPES = ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'OPENING_STOCK', 'DAMAGE', 'EXPIRED'] as const;

const AdjustStockSchema = z.object({
  productId: z.string().min(1),
  warehouseId: z.string().min(1).optional(),
  type: z.enum(ADJUSTMENT_TYPES),
  quantity: z.number().positive().finite(),
  unitCost: z.number().min(0).optional(),
  notes: z.string().optional(),
  referenceNumber: z.string().optional(),
});

const MovementQuerySchema = z.object({
  productId: z.string().min(1).optional(),
  warehouseId: z.string().min(1).optional(),
  type: z.nativeEnum(StockMovementType).optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(2000).default(20),
});

const TransferStockSchema = z.object({
  productId: z.string().min(1),
  fromWarehouseId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  quantity: z.number().positive().finite(),
  notes: z.string().optional(),
});

export class InventoryController {
  getStockSummary = async (req: Request, res: Response) => {
    const warehouseId = typeof req.query.warehouseId === 'string' && req.query.warehouseId ? req.query.warehouseId : undefined;
    const result = await inventoryService.getStockSummary(req.organizationId!, warehouseId);
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
    // empty-string params (e.g. ?type=) are treated as absent
    const raw = Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '' && v !== undefined));
    const query = MovementQuerySchema.parse(raw);
    const result = await inventoryService.getStockMovements(req.organizationId!, query);
    res.json(successResponse({ movements: result.data, total: result.meta.total, page: result.meta.page, totalPages: result.meta.totalPages }));
  };
  getValuation = async (req: Request, res: Response) => {
    const result = await inventoryService.getInventoryValuation(req.organizationId!);
    res.json(successResponse(result));
  };
}
export const inventoryController = new InventoryController();
