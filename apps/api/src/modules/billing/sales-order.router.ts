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

const SOItemSchema = z.object({
  productId: z.string(),
  description: z.string().optional(),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  taxRate: z.number().min(0).max(100).default(0),
  discount: z.number().min(0).max(100).default(0),
  unit: z.string().optional(),
});

const CreateSOSchema = z.object({
  customerId: z.string(),
  orderDate: z.coerce.date(),
  deliveryDate: z.coerce.date().optional(),
  quotationId: z.string().optional(),
  items: z.array(SOItemSchema).min(1),
  discountAmount: z.number().min(0).default(0),
  notes: z.string().optional(),
  terms: z.string().optional(),
  shippingAddress: z.record(z.string()).optional(),
});

router.get('/', async (req: Request, res: Response) => {
  const { page = 1, limit = 20, status, customerId, search } = req.query as any;
  const where: Prisma.SalesOrderWhereInput = {
    organizationId: req.organizationId!,
    ...(status && { status: status as any }),
    ...(customerId && { customerId }),
    ...(search && { orderNumber: { contains: search, mode: 'insensitive' } }),
  };
  const [data, total] = await Promise.all([
    prisma.salesOrder.findMany({ where, skip: (+page - 1) * +limit, take: +limit, orderBy: { createdAt: 'desc' }, include: { customer: { select: { id: true, name: true } } } }),
    prisma.salesOrder.count({ where }),
  ]);
  res.json(paginatedResponse(data, { page: +page, limit: +limit, total, totalPages: Math.ceil(total / +limit) }));
});

router.post('/', async (req: Request, res: Response) => {
  const input = CreateSOSchema.parse(req.body);
  const count = await prisma.salesOrder.count({ where: { organizationId: req.organizationId! } });
  const org = await prisma.organization.findUnique({ where: { id: req.organizationId! }, select: { salesOrderPrefix: true } });

  let subtotal = 0, taxAmount = 0;
  const itemsData = input.items.map(item => {
    const lineTotal = item.quantity * item.unitPrice;
    const discAmt = lineTotal * (item.discount || 0) / 100;
    const taxable = lineTotal - discAmt;
    const tax = taxable * item.taxRate / 100;
    subtotal += taxable;
    taxAmount += tax;
    return { ...item, taxAmount: tax, amount: taxable + tax };
  });

  const totalAmount = subtotal - input.discountAmount + taxAmount;

  const order = await prisma.salesOrder.create({
    data: {
      organizationId: req.organizationId!, branchId: req.branchId, customerId: input.customerId,
      orderNumber: `${org?.salesOrderPrefix || 'SO'}-${String(count + 1).padStart(5, '0')}`,
      orderDate: input.orderDate, deliveryDate: input.deliveryDate, quotationId: input.quotationId,
      status: 'CONFIRMED', subtotal, discountAmount: input.discountAmount, taxAmount, totalAmount,
      notes: input.notes, terms: input.terms,
      shippingAddress: input.shippingAddress as Prisma.InputJsonValue, createdBy: req.userId,
      items: { create: itemsData.map(i => ({ productId: i.productId, description: i.description || '', quantity: i.quantity, fulfilledQty: 0, unitPrice: i.unitPrice, discount: i.discount ?? 0, taxRate: i.taxRate, taxAmount: i.taxAmount, amount: i.amount, unit: i.unit })) },
    },
    include: { items: true, customer: { select: { id: true, name: true } } },
  });
  res.status(201).json(successResponse(order, 'Sales order created'));
});

router.get('/:id', async (req: Request, res: Response) => {
  const order = await prisma.salesOrder.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! }, include: { items: true, customer: true } });
  res.json(successResponse(order));
});

router.post('/:id/convert-to-invoice', async (req: Request, res: Response) => {
  const so = await prisma.salesOrder.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! }, include: { items: true } });
  if (!so) return res.status(404).json({ error: 'Sales order not found' });

  const count = await prisma.invoice.count({ where: { organizationId: req.organizationId! } });
  const org = await prisma.organization.findUnique({ where: { id: req.organizationId! }, select: { invoicePrefix: true } });

  const invoice = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.create({
      data: {
        organizationId: req.organizationId!, branchId: so.branchId, customerId: so.customerId, salesOrderId: so.id,
        invoiceNumber: `${org?.invoicePrefix || 'INV'}-${String(count + 1).padStart(5, '0')}`,
        invoiceType: 'GST_INVOICE', status: 'CONFIRMED', invoiceDate: new Date(),
        subtotal: so.subtotal, discountAmount: so.discountAmount, taxableAmount: so.subtotal,
        taxAmount: so.taxAmount, cgstAmount: Number(so.taxAmount) / 2, sgstAmount: Number(so.taxAmount) / 2, igstAmount: 0,
        totalAmount: so.totalAmount, balanceAmount: so.totalAmount,
        notes: so.notes, createdBy: req.userId,
        items: { create: so.items.map(i => ({ productId: i.productId, description: i.description || '', quantity: i.quantity, unitPrice: i.unitPrice, taxableAmount: Number(i.amount) - Number(i.taxAmount), taxRate: i.taxRate, taxAmount: i.taxAmount, cgstAmount: Number(i.taxAmount) / 2, sgstAmount: Number(i.taxAmount) / 2, igstAmount: 0, amount: i.amount })) },
      },
    });
    await tx.salesOrder.update({ where: { id: so.id }, data: { status: 'INVOICED' } });
    return inv;
  });
  res.status(201).json(successResponse(invoice, 'Converted to invoice'));
});

router.delete('/:id', async (req: Request, res: Response) => {
  await prisma.salesOrder.update({ where: { id: req.params.id }, data: { status: 'CANCELLED' } });
  res.json(successResponse({ message: 'Order cancelled' }));
});

export { router as salesOrderRouter };
