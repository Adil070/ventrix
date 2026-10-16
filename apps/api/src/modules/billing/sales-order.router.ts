import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse, paginatedResponse, toDecimal, roundTo } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { BadRequestError, NotFoundError } from '../../shared/errors';
import { z } from 'zod';
import { Prisma, SalesOrderStatus } from '@prisma/client';
import { invoiceService } from './invoice.service';
import { buildInvoiceInputFromSource } from './conversion';
import { nextSequenceNumber, retryOnUniqueViolation } from '../../shared/helpers/sequence';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

// Optional ids: '' (blank select) means "not set".
const optionalId = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().min(1).optional());

const SOItemSchema = z.object({
  productId: z.string().min(1),
  description: z.string().optional(),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  taxRate: z.number().min(0).max(100).default(0),
  discount: z.number().min(0).max(100).default(0),
  unit: z.string().optional(),
});

const CreateSOSchema = z.object({
  customerId: z.string().min(1),
  orderDate: z.coerce.date(),
  deliveryDate: z.coerce.date().optional(),
  quotationId: optionalId,
  items: z.array(SOItemSchema).min(1),
  discountAmount: z.number().min(0).default(0),
  notes: z.string().optional(),
  terms: z.string().optional(),
  shippingAddress: z.record(z.string()).optional(),
});

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  status: z.preprocess((v) => (v === '' ? undefined : v), z.nativeEnum(SalesOrderStatus).optional()),
  customerId: optionalId,
  search: z.string().optional(),
});

const NOT_INVOICEABLE: SalesOrderStatus[] = ['INVOICED', 'CANCELLED'];

async function findOrderOrThrow(id: string, organizationId: string) {
  const so = await prisma.salesOrder.findFirst({ where: { id, organizationId }, include: { items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } } });
  if (!so) throw new NotFoundError('Sales order', id);
  return so;
}

router.get('/', async (req: Request, res: Response) => {
  const { page, limit, status, customerId, search } = ListQuerySchema.parse(req.query);
  const where: Prisma.SalesOrderWhereInput = {
    organizationId: req.organizationId!,
    ...(status && { status }),
    ...(customerId && { customerId }),
    ...(search && { orderNumber: { contains: search, mode: 'insensitive' } }),
  };
  const [data, total] = await Promise.all([
    prisma.salesOrder.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { customer: { select: { id: true, name: true } } } }),
    prisma.salesOrder.count({ where }),
  ]);
  res.json(paginatedResponse(data, { page, limit, total, totalPages: Math.ceil(total / limit) }));
});

router.post('/', async (req: Request, res: Response) => {
  const input = CreateSOSchema.parse(req.body);
  const organizationId = req.organizationId!;

  const productIds = [...new Set(input.items.map(i => i.productId))];
  const [customer, quotation, products] = await Promise.all([
    prisma.customer.count({ where: { id: input.customerId, organizationId } }),
    input.quotationId ? prisma.quotation.count({ where: { id: input.quotationId, organizationId } }) : 1,
    prisma.product.count({ where: { id: { in: productIds }, organizationId } }),
  ]);
  if (!customer) throw new NotFoundError('Customer', input.customerId);
  if (!quotation) throw new NotFoundError('Quotation', input.quotationId);
  if (products !== productIds.length) throw new BadRequestError('One or more products were not found');

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { salesOrderPrefix: true } });
  const prefix = `${org?.salesOrderPrefix || 'SO'}-`;

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

  const order = await retryOnUniqueViolation('orderNumber', () => prisma.$transaction(async (tx) => {
    const orderNumber = await nextSequenceNumber(tx, organizationId, 'salesOrder', prefix, 5);
    return tx.salesOrder.create({
      data: {
        organizationId, branchId: req.branchId, customerId: input.customerId,
        orderNumber,
        orderDate: input.orderDate, deliveryDate: input.deliveryDate, quotationId: input.quotationId,
        status: 'CONFIRMED', subtotal, discountAmount: input.discountAmount, taxAmount, totalAmount,
        notes: input.notes, terms: input.terms,
        shippingAddress: input.shippingAddress as Prisma.InputJsonValue, createdBy: req.userId,
        items: { create: itemsData.map((i, idx) => ({ productId: i.productId, description: i.description || '', quantity: i.quantity, fulfilledQty: 0, unitPrice: i.unitPrice, discount: i.discount ?? 0, taxRate: i.taxRate, taxAmount: i.taxAmount, amount: i.amount, unit: i.unit, sortOrder: idx })) },
      },
      include: { items: true, customer: { select: { id: true, name: true } } },
    });
  }));
  res.status(201).json(successResponse(order, 'Sales order created'));
});

router.get('/:id', async (req: Request, res: Response) => {
  const order = await prisma.salesOrder.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! }, include: { items: true, customer: true } });
  if (!order) throw new NotFoundError('Sales order', req.params.id);
  res.json(successResponse(order));
});

router.post('/:id/convert-to-invoice', async (req: Request, res: Response) => {
  const organizationId = req.organizationId!;
  const so = await findOrderOrThrow(req.params.id, organizationId);
  if (NOT_INVOICEABLE.includes(so.status)) {
    throw new BadRequestError(`Cannot convert a sales order in ${so.status} status`);
  }

  // Invoice whatever is still open on each line (earlier invoices for this order count as fulfilled).
  const openQty = so.items.map(i => roundTo(Math.max(0, toDecimal(i.quantity) - toDecimal(i.fulfilledQty)), 3));
  const input = await buildInvoiceInputFromSource(organizationId, so, so.items, {
    salesOrderId: so.id, lineQuantities: openQty, reference: `Sales order ${so.orderNumber}`,
  });

  const invoice = await invoiceService.createInvoice(organizationId, so.branchId ?? req.branchId, req.userId!, input, {
    // Runs after the per-org invoice lock: if another request converted/cancelled/changed this order in the
    // meantime, its updatedAt no longer matches and this conversion is refused (and rolled back).
    beforeCreate: async (tx) => {
      const { count } = await tx.salesOrder.updateMany({
        where: { id: so.id, organizationId, status: { notIn: NOT_INVOICEABLE }, updatedAt: so.updatedAt },
        data: { updatedAt: new Date() },
      });
      if (count !== 1) throw new BadRequestError('Sales order has already been invoiced or was changed; reload and try again');
    },
    // createInvoice already booked the invoiced quantities on the order; everything open was invoiced, so
    // the order is fully invoiced (this also covers lines without a product, which fulfilment cannot track).
    onCreated: async (tx) => {
      for (const item of so.items) {
        if (toDecimal(item.fulfilledQty) < toDecimal(item.quantity)) {
          await tx.salesOrderItem.updateMany({
            where: { id: item.id, salesOrderId: so.id, fulfilledQty: { lt: item.quantity } },
            data: { fulfilledQty: item.quantity },
          });
        }
      }
      await tx.salesOrder.update({ where: { id: so.id }, data: { status: 'INVOICED' } });
    },
  });
  res.status(201).json(successResponse(invoice, 'Converted to invoice'));
});

router.delete('/:id', async (req: Request, res: Response) => {
  const so = await findOrderOrThrow(req.params.id, req.organizationId!);
  if (so.status === 'CANCELLED') throw new BadRequestError('Sales order is already cancelled');
  const invoiced = await prisma.invoice.count({ where: { salesOrderId: so.id, organizationId: req.organizationId!, status: { not: 'CANCELLED' } } });
  if (invoiced > 0 || so.status === 'INVOICED') {
    throw new BadRequestError('Cannot cancel a sales order that has been invoiced; cancel its invoices first');
  }
  await prisma.salesOrder.update({ where: { id: so.id }, data: { status: 'CANCELLED' } });
  res.json(successResponse({ message: 'Order cancelled' }));
});

export { router as salesOrderRouter };
