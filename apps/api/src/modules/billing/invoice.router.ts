import { Router } from 'express';
import { Request, Response } from 'express';
import { invoiceService } from './invoice.service';
import { authenticate, requirePermission } from '../../shared/middleware/auth.middleware';
import { validateBody, validateQuery, validateParams } from '../../shared/middleware/validate.middleware';
import { successResponse, createdResponse, paginatedResponse } from '../../shared/helpers/response.helper';
import { auditMiddleware } from '../../shared/middleware/audit.middleware';
import {
  CreateInvoiceDto,
  UpdateInvoiceDto,
  InvoiceQueryDto,
  SendInvoiceDto,
  RecordPaymentDto,
} from './invoice.dto';
import { z } from 'zod';
import { PDFService } from '../documents/pdf.service';

export const invoiceRouter = Router();

invoiceRouter.use(authenticate);

// GET /invoices
invoiceRouter.get(
  '/',
  requirePermission('invoices', 'VIEW'),
  validateQuery(InvoiceQueryDto),
  async (req: Request, res: Response) => {
    const result = await invoiceService.getInvoices(req.organizationId!, req.query as any);
    res.json(paginatedResponse(result.data, result.pagination));
  }
);

// POST /invoices
invoiceRouter.post(
  '/',
  requirePermission('invoices', 'CREATE'),
  validateBody(CreateInvoiceDto),
  auditMiddleware('invoices', 'CREATE'),
  async (req: Request, res: Response) => {
    const invoice = await invoiceService.createInvoice(
      req.organizationId!,
      req.user!.branchId,
      req.user!.userId,
      req.body
    );
    res.status(201).json(createdResponse(invoice, 'Invoice created successfully'));
  }
);

// GET /invoices/outstanding
invoiceRouter.get(
  '/outstanding',
  requirePermission('invoices', 'VIEW'),
  async (req: Request, res: Response) => {
    const { customerId } = req.query as { customerId?: string };
    const result = await invoiceService.getOutstandingInvoices(req.organizationId!, customerId);
    res.json(successResponse(result));
  }
);

// GET /invoices/stats
invoiceRouter.get(
  '/stats',
  requirePermission('invoices', 'VIEW'),
  async (req: Request, res: Response) => {
    const { from, to } = req.query as { from?: string; to?: string };
    const period = {
      from: from ? new Date(from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      to: to ? new Date(to) : new Date(),
    };
    const result = await invoiceService.getInvoiceStats(req.organizationId!, period);
    res.json(successResponse(result));
  }
);

// GET /invoices/:id
invoiceRouter.get(
  '/:id',
  requirePermission('invoices', 'VIEW'),
  async (req: Request, res: Response) => {
    const invoice = await invoiceService.getInvoice(req.organizationId!, req.params.id);
    res.json(successResponse(invoice));
  }
);

// PATCH /invoices/:id/confirm
invoiceRouter.patch(
  '/:id/confirm',
  requirePermission('invoices', 'EDIT'),
  auditMiddleware('invoices', 'CONFIRM'),
  async (req: Request, res: Response) => {
    const result = await invoiceService.confirmInvoice(
      req.organizationId!,
      req.params.id,
      req.user!.userId
    );
    res.json(successResponse(result));
  }
);

// POST /invoices/:id/payment
invoiceRouter.post(
  '/:id/payment',
  requirePermission('invoices', 'CREATE'),
  validateBody(RecordPaymentDto),
  auditMiddleware('invoices', 'RECORD_PAYMENT'),
  async (req: Request, res: Response) => {
    const payment = await invoiceService.recordPayment(
      req.organizationId!,
      req.params.id,
      req.user!.userId,
      req.body
    );
    res.status(201).json(createdResponse(payment, 'Payment recorded successfully'));
  }
);

// PATCH /invoices/:id/cancel
invoiceRouter.patch(
  '/:id/cancel',
  requirePermission('invoices', 'EDIT'),
  validateBody(z.object({ reason: z.string().min(1) })),
  auditMiddleware('invoices', 'CANCEL'),
  async (req: Request, res: Response) => {
    const result = await invoiceService.cancelInvoice(
      req.organizationId!,
      req.params.id,
      req.body.reason
    );
    res.json(successResponse(result));
  }
);

// GET /invoices/:id/pdf
invoiceRouter.get(
  '/:id/pdf',
  requirePermission('invoices', 'PRINT'),
  async (req: Request, res: Response) => {
    const invoice = await invoiceService.getInvoice(req.organizationId!, req.params.id);
    const pdfService = new PDFService();
    const pdfBuffer = await pdfService.generateInvoicePDF(invoice as any);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Invoice-${invoice.invoiceNumber}.pdf"`);
    res.send(pdfBuffer);
  }
);
