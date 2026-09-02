import { Request, Response } from 'express';
import { supplierService } from './supplier.service';
import { CreateSupplierSchema, UpdateSupplierSchema, SupplierQuerySchema } from './supplier.dto';
import { successResponse } from '../../shared/helpers/response.helper';

export class SupplierController {
  list = async (req: Request, res: Response) => {
    const query = SupplierQuerySchema.parse(req.query);
    const result = await supplierService.listSuppliers(req.organizationId!, query);
    res.json(successResponse({ suppliers: result.data, total: result.meta.total, page: result.meta.page, totalPages: result.meta.totalPages }));
  };
  create = async (req: Request, res: Response) => {
    const input = CreateSupplierSchema.parse(req.body);
    const supplier = await supplierService.createSupplier(req.organizationId!, input);
    res.status(201).json(successResponse(supplier, 'Supplier created successfully'));
  };
  getById = async (req: Request, res: Response) => {
    const supplier = await supplierService.getSupplier(req.organizationId!, req.params.id);
    res.json(successResponse(supplier));
  };
  update = async (req: Request, res: Response) => {
    const input = UpdateSupplierSchema.parse(req.body);
    const supplier = await supplierService.updateSupplier(req.organizationId!, req.params.id, input);
    res.json(successResponse(supplier, 'Supplier updated successfully'));
  };
  delete = async (req: Request, res: Response) => {
    const result = await supplierService.deleteSupplier(req.organizationId!, req.params.id);
    res.json(successResponse(result));
  };
  getLedger = async (req: Request, res: Response) => {
    const { fromDate, toDate } = req.query as { fromDate?: string; toDate?: string };
    const result = await supplierService.getSupplierLedger(req.organizationId!, req.params.id, fromDate, toDate);
    res.json(successResponse(result));
  };
}
export const supplierController = new SupplierController();
