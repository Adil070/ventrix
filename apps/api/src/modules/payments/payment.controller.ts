import { Request, Response } from 'express';
import { paymentService, RecordPaymentSchema } from './payment.service';
import { successResponse } from '../../shared/helpers/response.helper';

export class PaymentController {
  list = async (req: Request, res: Response) => {
    const query = { ...req.query, page: req.query.page ? +req.query.page : 1, limit: req.query.limit ? +req.query.limit : 20 } as any;
    const result = await paymentService.listPayments(req.organizationId!, query);
    res.json(successResponse({ payments: result.data, total: result.meta.total, page: result.meta.page, totalPages: result.meta.totalPages }));
  };
  create = async (req: Request, res: Response) => {
    const input = RecordPaymentSchema.parse(req.body);
    const payment = await paymentService.recordPayment(req.organizationId!, req.userId!, input);
    res.status(201).json(successResponse(payment, 'Payment recorded successfully'));
  };
  getById = async (req: Request, res: Response) => {
    const payment = await paymentService.getPayment(req.organizationId!, req.params.id);
    res.json(successResponse(payment));
  };
}
export const paymentController = new PaymentController();
