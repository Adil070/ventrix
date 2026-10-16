import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse, paginatedResponse } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { BadRequestError, NotFoundError } from '../../shared/errors';
import { z } from 'zod';
import { Prisma, QuotationStatus } from '@prisma/client';
import { invoiceService } from './invoice.service';
import { buildInvoiceInputFromSource } from './conversion';
import { nextSequenceNumber, retryOnUniqueViolation } from '../../shared/helpers/sequence';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

// Optional ids: '' (blank select) means "not set".
const optionalId = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().min(1).optional());

const QuotationItemSchema = z.object({
  productId: optionalId,
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  discount: z.number().min(0).max(100).default(0),
  taxRate: z.number().min(0).max(100).default(0),
  unit: z.string().optional(),
});

const CreateQuotationSchema = z.object({
  customerId: optionalId,
  quotationDate: z.coerce.date(),
  validUntil: z.coerce.date().optional(),
  items: z.array(QuotationItemSchema).min(1),
  discountAmount: z.number().min(0).default(0),
  notes: z.string().optional(),
  terms: z.string().optional(),
});

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  status: z.preprocess((v) => (v === '' ? undefined : v), z.nativeEnum(QuotationStatus).optional()),
  customerId: optionalId,
  search: z.string().optional(),
});

// A quotation can be turned into an invoice until it is converted, rejected or expired.
const CONVERTIBLE: QuotationStatus[] = ['DRAFT', 'SENT', 'ACCEPTED'];

const calcTotals = (items: any[], extraDiscount: number) => {
  let subtotal = 0, taxAmount = 0;
  const computed = items.map(item => {
    const lineTotal = item.quantity * item.unitPrice;
    const discAmt = lineTotal * (item.discount || 0) / 100;
    const taxable = lineTotal - discAmt;
    const tax = taxable * item.taxRate / 100;
    subtotal += taxable;
    taxAmount += tax;
    return { ...item, taxAmount: tax, amount: taxable + tax };
  });
  const totalAmount = subtotal - extraDiscount + taxAmount;
  return { computed, subtotal, taxAmount, totalAmount };
};

async function findQuotationOrThrow(id: string, organizationId: string) {
  const q = await prisma.quotation.findFirst({ where: { id, organizationId }, include: { items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } } });
  if (!q) throw new NotFoundError('Quotation', id);
  return q;
}

router.get('/', async (req: Request, res: Response) => {
  const { page, limit, status, customerId, search } = ListQuerySchema.parse(req.query);
  const where: Prisma.QuotationWhereInput = {
    organizationId: req.organizationId!,
    ...(status && { status }),
    ...(customerId && { customerId }),
    ...(search && { quotationNumber: { contains: search, mode: 'insensitive' } }),
  };
  const [data, total] = await Promise.all([
    prisma.quotation.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { customer: { select: { id: true, name: true } } } }),
    prisma.quotation.count({ where }),
  ]);
  res.json(paginatedResponse(data, { page, limit, total, totalPages: Math.ceil(total / limit) }));
});

router.post('/', async (req: Request, res: Response) => {
  const input = CreateQuotationSchema.parse(req.body);
  const organizationId = req.organizationId!;

  const productIds = [...new Set(input.items.map(i => i.productId).filter((x): x is string => !!x))];
  const [customer, products] = await Promise.all([
    input.customerId ? prisma.customer.count({ where: { id: input.customerId, organizationId } }) : 1,
    productIds.length ? prisma.product.count({ where: { id: { in: productIds }, organizationId } }) : 0,
  ]);
  if (!customer) throw new NotFoundError('Customer', input.customerId);
  if (products !== productIds.length) throw new BadRequestError('One or more products were not found');

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { quotationPrefix: true } });
  const prefix = `${org?.quotationPrefix || 'QUO'}-`;

  const { computed, subtotal, taxAmount, totalAmount } = calcTotals(input.items, input.discountAmount);

  const quotation = await retryOnUniqueViolation('quotationNumber', () => prisma.$transaction(async (tx) => {
    const quotationNumber = await nextSequenceNumber(tx, organizationId, 'quotation', prefix, 5);
    return tx.quotation.create({
      data: {
        organizationId, branchId: req.branchId, customerId: input.customerId,
        quotationNumber, quotationDate: input.quotationDate, validUntil: input.validUntil, status: 'DRAFT',
        subtotal, discountAmount: input.discountAmount, taxAmount, totalAmount,
        notes: input.notes, terms: input.terms, createdBy: req.userId,
        items: { create: computed.map((item, idx) => ({ productId: item.productId, description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, discount: item.discount ?? 0, taxRate: item.taxRate, taxAmount: item.taxAmount, amount: item.amount, unit: item.unit, sortOrder: idx })) },
      },
      include: { items: true, customer: { select: { id: true, name: true } } },
    });
  }));
  res.status(201).json(successResponse(quotation, 'Quotation created'));
});

router.get('/:id', async (req: Request, res: Response) => {
  const q = await prisma.quotation.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! }, include: { items: true, customer: true } });
  if (!q) throw new NotFoundError('Quotation', req.params.id);
  res.json(successResponse(q));
});

router.post('/:id/send', async (req: Request, res: Response) => {
  const q = await findQuotationOrThrow(req.params.id, req.organizationId!);
  if (q.status !== 'DRAFT' && q.status !== 'SENT') {
    throw new BadRequestError(`Cannot send a quotation in ${q.status} status`);
  }
  const updated = await prisma.quotation.update({ where: { id: q.id }, data: { status: 'SENT' } });
  res.json(successResponse(updated));
});

router.post('/:id/convert-to-invoice', async (req: Request, res: Response) => {
  const organizationId = req.organizationId!;
  const q = await findQuotationOrThrow(req.params.id, organizationId);
  if (!CONVERTIBLE.includes(q.status)) {
    throw new BadRequestError(`Cannot convert a quotation in ${q.status} status`);
  }

  const input = await buildInvoiceInputFromSource(organizationId, q, q.items, { reference: `Quotation ${q.quotationNumber}` });

  // Same transaction as the invoice: the conditional update re-checks the status after the invoice-number
  // lock, so a second (or concurrent) convert fails and rolls its invoice back.
  const invoice = await invoiceService.createInvoice(organizationId, q.branchId ?? req.branchId, req.userId!, input, {
    onCreated: async (tx, inv) => {
      const { count } = await tx.quotation.updateMany({
        where: { id: q.id, organizationId, status: { in: CONVERTIBLE } },
        data: { status: 'CONVERTED', convertedToInvoiceId: inv.id },
      });
      if (count !== 1) throw new BadRequestError('Quotation has already been converted');
    },
  });
  res.status(201).json(successResponse(invoice, 'Converted to invoice'));
});

router.delete('/:id', async (req: Request, res: Response) => {
  const q = await findQuotationOrThrow(req.params.id, req.organizationId!);
  if (q.status === 'CONVERTED') throw new BadRequestError('Cannot delete a quotation that has been converted to an invoice');
  await prisma.quotation.delete({ where: { id: q.id } });
  res.json(successResponse({ message: 'Quotation deleted' }));
});

export { router as quotationRouter };
