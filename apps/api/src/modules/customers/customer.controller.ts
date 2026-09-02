import { Request, Response } from 'express';
import { customerService } from './customer.service';
import { CreateCustomerSchema, UpdateCustomerSchema, CustomerQuerySchema } from './customer.dto';
import { successResponse } from '../../shared/helpers/response.helper';
import { validate } from '../../shared/middleware/validate.middleware';

export class CustomerController {
  list = async (req: Request, res: Response) => {
    const query = CustomerQuerySchema.parse(req.query);
    const result = await customerService.listCustomers(req.organizationId!, query);
    res.json(successResponse({ customers: result.data, total: result.meta.total, page: result.meta.page, totalPages: result.meta.totalPages }));
  };

  create = async (req: Request, res: Response) => {
    const input = CreateCustomerSchema.parse(req.body);
    const customer = await customerService.createCustomer(req.organizationId!, input);
    res.status(201).json(successResponse(customer, 'Customer created successfully'));
  };

  getById = async (req: Request, res: Response) => {
    const customer = await customerService.getCustomer(req.organizationId!, req.params.id);
    res.json(successResponse(customer));
  };

  update = async (req: Request, res: Response) => {
    const input = UpdateCustomerSchema.parse(req.body);
    const customer = await customerService.updateCustomer(req.organizationId!, req.params.id, input);
    res.json(successResponse(customer, 'Customer updated successfully'));
  };

  delete = async (req: Request, res: Response) => {
    const result = await customerService.deleteCustomer(req.organizationId!, req.params.id);
    res.json(successResponse(result));
  };

  getLedger = async (req: Request, res: Response) => {
    const { fromDate, toDate } = req.query as { fromDate?: string; toDate?: string };
    const result = await customerService.getCustomerLedger(
      req.organizationId!,
      req.params.id,
      fromDate,
      toDate
    );
    res.json(successResponse(result));
  };

  getStatement = async (req: Request, res: Response) => {
    const { fromDate, toDate } = req.query as { fromDate: string; toDate: string };
    const result = await customerService.getCustomerStatement(
      req.organizationId!,
      req.params.id,
      fromDate,
      toDate
    );
    res.json(successResponse(result));
  };
}

export const customerController = new CustomerController();
