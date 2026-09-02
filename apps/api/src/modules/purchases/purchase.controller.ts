import { Request, Response } from 'express';
import { purchaseService } from './purchase.service';
import { CreatePurchaseSchema, PurchaseQuerySchema } from './purchase.dto';
import { successResponse } from '../../shared/helpers/response.helper';

export class PurchaseController {
  list = async (req: Request, res: Response) => {
    const query = PurchaseQuerySchema.parse(req.query);
    const result = await purchaseService.listPurchases(req.organizationId!, query);
    res.json(successResponse({ purchases: result.data, total: result.meta.total, page: result.meta.page, totalPages: result.meta.totalPages }));
  };
  create = async (req: Request, res: Response) => {
    const input = CreatePurchaseSchema.parse(req.body);
    const purchase = await purchaseService.createPurchase(req.organizationId!, req.branchId, req.userId!, input);
    res.status(201).json(successResponse(purchase, 'Purchase bill created'));
  };
  getById = async (req: Request, res: Response) => {
    const purchase = await purchaseService.getPurchase(req.organizationId!, req.params.id);
    res.json(successResponse(purchase));
  };
  cancel = async (req: Request, res: Response) => {
    const result = await purchaseService.cancelPurchase(req.organizationId!, req.params.id, req.userId!);
    res.json(successResponse(result));
  };
}
export const purchaseController = new PurchaseController();
