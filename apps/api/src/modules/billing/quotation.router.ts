import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse, paginatedResponse } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

const QuotationItemSchema = z.object({
  productId: z.string().optional(),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  discount: z.number().min(0).max(100).default(0),
  taxRate: z.number().min(0).max(100).default(0),
  unit: z.string().optional(),
});

const CreateQuotationSchema = z.object({
  customerId: z.string().optional(),
  quotationDate: z.coerce.date(),
  validUntil: z.coerce.date().optional(),
  items: z.array(QuotationItemSchema).min(1),
  discountAmount: z.number().min(0).default(0),
  notes: z.string().optional(),
  terms: z.string().optional(),
});

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

router.get('/', async (req: Request, res: Response) => {
  const { page = 1, limit = 20, status, customerId, search } = req.query as any;
  const where: Prisma.QuotationWhereInput = {
    organizationId: req.organizationId!,
    ...(status && { status: status as any }),
    ...(customerId && { customerId }),
    ...(search && { quotationNumber: { contains: search, mode: 'insensitive' } }),
  };
  const [data, total] = await Promise.all([
    prisma.quotation.findMany({ where, skip: (+page - 1) * +limit, take: +limit, orderBy: { createdAt: 'desc' }, include: { customer: { select: { id: true, name: true } } } }),
    prisma.quotation.count({ where }),
  ]);
  res.json(paginatedResponse(data, { page: +page, limit: +limit, total, totalPages: Math.ceil(total / +limit) }));
});

router.post('/', async (req: Request, res: Response) => {
  const input = CreateQuotationSchema.parse(req.body);
  const count = await prisma.quotation.count({ where: { organizationId: req.organizationId! } });
  const org = await prisma.organization.findUnique({ where: { id: req.organizationId! }, select: { quotationPrefix: true } });
  const quotationNumber = `${org?.quotationPrefix || 'QUO'}-${String(count + 1).padStart(5, '0')}`;

  const { computed, subtotal, taxAmount, totalAmount } = calcTotals(input.items, input.discountAmount);

  const quotation = await prisma.quotation.create({
    data: {
      organizationId: req.organizationId!, branchId: req.branchId, customerId: input.customerId,
      quotationNumber, quotationDate: input.quotationDate, validUntil: input.validUntil, status: 'DRAFT',
      subtotal, discountAmount: input.discountAmount, taxAmount, totalAmount,
      notes: input.notes, terms: input.terms, createdBy: req.userId,
      items: { create: computed.map(item => ({ productId: item.productId, description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, discount: item.discount ?? 0, taxRate: item.taxRate, taxAmount: item.taxAmount, amount: item.amount, unit: item.unit })) },
    },
    include: { items: true, customer: { select: { id: true, name: true } } },
  });
  res.status(201).json(successResponse(quotation, 'Quotation created'));
});

router.get('/:id', async (req: Request, res: Response) => {
  const q = await prisma.quotation.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! }, include: { items: true, customer: true } });
  res.json(successResponse(q));
});

router.post('/:id/send', async (req: Request, res: Response) => {
  const q = await prisma.quotation.update({ where: { id: req.params.id }, data: { status: 'SENT' } });
  res.json(successResponse(q));
});

router.post('/:id/convert-to-invoice', async (req: Request, res: Response) => {
  const q = await prisma.quotation.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! }, include: { items: true } });
  if (!q) return res.status(404).json({ error: 'Quotation not found' });

  const count = await prisma.invoice.count({ where: { organizationId: req.organizationId! } });
  const org = await prisma.organization.findUnique({ where: { id: req.organizationId! }, select: { invoicePrefix: true } });
  const invoiceNumber = `${org?.invoicePrefix || 'INV'}-${String(count + 1).padStart(5, '0')}`;

  const invoice = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.create({
      data: {
        organizationId: req.organizationId!, branchId: req.branchId, customerId: q.customerId,
        invoiceNumber, invoiceType: 'GST_INVOICE', status: 'CONFIRMED', invoiceDate: new Date(),
        subtotal: q.subtotal, discountAmount: q.discountAmount, taxableAmount: q.subtotal,
        taxAmount: q.taxAmount, cgstAmount: Number(q.taxAmount) / 2, sgstAmount: Number(q.taxAmount) / 2,
        igstAmount: 0, totalAmount: q.totalAmount, balanceAmount: q.totalAmount,
        notes: q.notes, createdBy: req.userId,
        items: { create: q.items.map(i => ({
          productId: i.productId, description: i.description!, quantity: i.quantity, unitPrice: i.unitPrice,
          discountAmount: Number(i.unitPrice) * Number(i.quantity) * Number(i.discount) / 100,
          taxableAmount: Number(i.amount) - Number(i.taxAmount),
          taxRate: i.taxRate, taxAmount: i.taxAmount,
          cgstAmount: Number(i.taxAmount) / 2, sgstAmount: Number(i.taxAmount) / 2, igstAmount: 0,
          amount: i.amount,
        })) },
      },
    });
    await tx.quotation.update({ where: { id: q.id }, data: { status: 'CONVERTED', convertedToInvoiceId: inv.id } });
    return inv;
  });
  res.status(201).json(successResponse(invoice, 'Converted to invoice'));
});

router.delete('/:id', async (req: Request, res: Response) => {
  await prisma.quotation.delete({ where: { id: req.params.id } });
  res.json(successResponse({ message: 'Quotation deleted' }));
});

export { router as quotationRouter };
