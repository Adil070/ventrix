import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse, paginatedResponse, createdResponse } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { NotFoundError, BadRequestError } from '../../shared/errors';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

// ─── Schemas ────────────────────────────────────────────────────────────────
const ReturnItemSchema = z.object({
  productId: z.string().optional(),
  description: z.string().min(1).optional(),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  taxRate: z.coerce.number().min(0).max(100).default(0),
});

const CreateReturnSchema = z.object({
  type: z.enum(['SALES_RETURN', 'PURCHASE_RETURN']),
  invoiceId: z.string().optional(),
  purchaseId: z.string().optional(),
  customerId: z.string().optional(),
  supplierId: z.string().optional(),
  returnDate: z.coerce.date().default(() => new Date()),
  reason: z.string().optional(),
  notes: z.string().optional(),
  generateCreditNote: z.boolean().default(false),
  items: z.array(ReturnItemSchema).min(1),
});

const CreateNoteSchema = z.object({
  type: z.enum(['CREDIT_NOTE', 'DEBIT_NOTE']),
  customerId: z.string().optional(),
  supplierId: z.string().optional(),
  returnOrderId: z.string().optional(),
  noteDate: z.coerce.date().default(() => new Date()),
  reason: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    description: z.string().min(1),
    quantity: z.coerce.number().positive(),
    unitPrice: z.coerce.number().min(0),
    taxRate: z.coerce.number().min(0).max(100).default(0),
  })).min(1),
});

// ─── Helpers ────────────────────────────────────────────────────────────────
async function nextNumber(organizationId: string, prefix: string, model: 'returnOrder' | 'creditDebitNote'): Promise<string> {
  const count = model === 'returnOrder'
    ? await prisma.returnOrder.count({ where: { organizationId } })
    : await prisma.creditDebitNote.count({ where: { returnOrder: { organizationId } } });
  return `${prefix}-${String(count + 1).padStart(6, '0')}`;
}

function calcItem(item: { quantity: number; unitPrice: number; taxRate?: number }) {
  const taxable = item.quantity * item.unitPrice;
  const taxAmount = (taxable * (item.taxRate || 0)) / 100;
  return { taxable, taxAmount, amount: taxable + taxAmount };
}

// ─── Return Orders ──────────────────────────────────────────────────────────
router.post('/return-orders', async (req: Request, res: Response) => {
  const input = CreateReturnSchema.parse(req.body);
  const organizationId = req.organizationId!;

  let totalAmount = 0;
  const itemsData = input.items.map((it) => {
    const c = calcItem(it);
    totalAmount += c.amount;
    return {
      productId: it.productId,
      description: it.description || 'Returned item',
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      taxAmount: c.taxAmount,
      amount: c.amount,
    };
  });

  const returnNumber = await nextNumber(organizationId, input.type === 'SALES_RETURN' ? 'SR' : 'PR', 'returnOrder');

  const created = await prisma.returnOrder.create({
    data: {
      organizationId,
      returnNumber,
      returnType: input.type,
      invoiceId: input.invoiceId,
      purchaseId: input.purchaseId,
      customerId: input.customerId,
      supplierId: input.supplierId,
      returnDate: input.returnDate,
      status: 'PENDING',
      totalAmount,
      reason: input.reason,
      notes: input.notes,
      createdBy: req.userId,
      items: { create: itemsData },
    },
    include: { items: true, customer: { select: { name: true } }, supplier: { select: { name: true } } },
  });

  res.status(201).json(createdResponse(created, 'Return order created'));
});

router.get('/return-orders', async (req: Request, res: Response) => {
  const { page = 1, limit = 20, status, type } = req.query as any;
  const where: Prisma.ReturnOrderWhereInput = {
    organizationId: req.organizationId!,
    ...(status && { status }),
    ...(type && { returnType: type }),
  };
  const [data, total] = await Promise.all([
    prisma.returnOrder.findMany({
      where, skip: (+page - 1) * +limit, take: +limit, orderBy: { createdAt: 'desc' },
      include: { customer: { select: { name: true } }, supplier: { select: { name: true } }, _count: { select: { items: true } } },
    }),
    prisma.returnOrder.count({ where }),
  ]);
  // Map returnType -> type and returnNumber -> returnOrderNumber for FE compatibility
  const mapped = data.map((r) => ({ ...r, type: r.returnType, returnOrderNumber: r.returnNumber }));
  res.json(paginatedResponse(mapped, { page: +page, limit: +limit, total, totalPages: Math.ceil(total / +limit) }));
});

router.get('/return-orders/:id', async (req: Request, res: Response) => {
  const r = await prisma.returnOrder.findFirst({
    where: { id: req.params.id, organizationId: req.organizationId! },
    include: { items: { include: { product: { select: { name: true } } } }, customer: true, supplier: true, creditDebitNotes: true },
  });
  if (!r) throw new NotFoundError('Return order', req.params.id);
  res.json(successResponse({ ...r, type: r.returnType, returnOrderNumber: r.returnNumber }));
});

router.post('/return-orders/:id/approve', async (req: Request, res: Response) => {
  const organizationId = req.organizationId!;
  const ret = await prisma.returnOrder.findFirst({ where: { id: req.params.id, organizationId }, include: { items: true } });
  if (!ret) throw new NotFoundError('Return order', req.params.id);
  if (ret.status === 'APPROVED') throw new BadRequestError('Return order already approved');

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.returnOrder.update({ where: { id: ret.id }, data: { status: 'APPROVED' } });

    // Restock for sales returns, deduct for purchase returns
    const defaultWarehouse = await tx.warehouse.findFirst({ where: { organizationId, isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
    for (const item of ret.items) {
      if (item.productId) {
        const product = await tx.product.findUnique({ where: { id: item.productId }, select: { trackInventory: true, openingStock: true } });
        if (product?.trackInventory) {
          const delta = ret.returnType === 'SALES_RETURN' ? Number(item.quantity) : -Number(item.quantity);
          await tx.product.update({ where: { id: item.productId }, data: { openingStock: Number(product.openingStock) + delta } });
          if (defaultWarehouse) {
            await tx.stockEntry.create({
              data: {
                organizationId, warehouseId: defaultWarehouse.id, productId: item.productId,
                movementType: ret.returnType === 'SALES_RETURN' ? 'SALE_RETURN' : 'PURCHASE_RETURN',
                quantity: delta, rate: item.unitPrice, amount: Math.abs(delta) * Number(item.unitPrice),
                referenceType: 'RETURN_ORDER', referenceId: ret.id, createdBy: req.userId,
              },
            });
          }
        }
      }
    }

    // Auto-generate credit/debit note
    let note = null;
    const noteNumber = await nextNumber(organizationId, ret.returnType === 'SALES_RETURN' ? 'CN' : 'DN', 'creditDebitNote');
    note = await tx.creditDebitNote.create({
      data: {
        returnOrderId: ret.id,
        noteNumber,
        type: ret.returnType === 'SALES_RETURN' ? 'CREDIT_NOTE' : 'DEBIT_NOTE',
        amount: ret.totalAmount,
        status: 'OPEN',
        notes: `Auto-generated for return ${ret.returnNumber}`,
      },
    });

    return { updated, note };
  });

  res.json(successResponse({ ...result.updated, status: 'APPROVED', approvedAt: new Date() }, 'Return order approved'));
});

router.post('/return-orders/:id/reject', async (req: Request, res: Response) => {
  const ret = await prisma.returnOrder.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! } });
  if (!ret) throw new NotFoundError('Return order', req.params.id);
  const updated = await prisma.returnOrder.update({ where: { id: ret.id }, data: { status: 'REJECTED' } });
  res.json(successResponse(updated, 'Return order rejected'));
});

// ─── Credit / Debit Notes ─────────────────────────────────────────────────────
router.post('/credit-notes', async (req: Request, res: Response) => {
  const input = CreateNoteSchema.parse(req.body);
  const organizationId = req.organizationId!;

  let amount = 0;
  for (const it of input.items) amount += calcItem(it).amount;

  // CreditDebitNote requires a returnOrderId. If none provided, create a backing
  // adjustment return order so standalone notes are supported.
  let returnOrderId = input.returnOrderId;
  if (!returnOrderId) {
    const returnNumber = await nextNumber(organizationId, 'ADJ', 'returnOrder');
    const backing = await prisma.returnOrder.create({
      data: {
        organizationId,
        returnNumber,
        returnType: input.type === 'CREDIT_NOTE' ? 'SALES_RETURN' : 'PURCHASE_RETURN',
        customerId: input.customerId,
        supplierId: input.supplierId,
        returnDate: input.noteDate,
        status: 'ADJUSTMENT',
        totalAmount: amount,
        reason: input.reason,
        notes: input.notes,
        createdBy: req.userId,
        items: { create: input.items.map((it) => { const c = calcItem(it); return { description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, taxAmount: c.taxAmount, amount: c.amount }; }) },
      },
    });
    returnOrderId = backing.id;
  }

  const noteNumber = await nextNumber(organizationId, input.type === 'CREDIT_NOTE' ? 'CN' : 'DN', 'creditDebitNote');
  const note = await prisma.creditDebitNote.create({
    data: { returnOrderId, noteNumber, type: input.type, amount, status: 'DRAFT', notes: input.notes },
    include: { returnOrder: { select: { customerId: true, supplierId: true, customer: { select: { name: true } }, supplier: { select: { name: true } } } } },
  });

  res.status(201).json(createdResponse({ ...note, noteDate: input.noteDate, reason: input.reason, totalAmount: amount, customer: note.returnOrder?.customer, supplier: note.returnOrder?.supplier }, 'Note created'));
});

router.get('/credit-notes', async (req: Request, res: Response) => {
  const { page = 1, limit = 20, type, status } = req.query as any;
  const where: Prisma.CreditDebitNoteWhereInput = {
    returnOrder: { organizationId: req.organizationId! },
    ...(type && { type }),
    ...(status && { status }),
  };
  const [data, total] = await Promise.all([
    prisma.creditDebitNote.findMany({
      where, skip: (+page - 1) * +limit, take: +limit, orderBy: { createdAt: 'desc' },
      include: { returnOrder: { select: { reason: true, returnDate: true, customer: { select: { name: true } }, supplier: { select: { name: true } } } } },
    }),
    prisma.creditDebitNote.count({ where }),
  ]);
  const mapped = data.map((n) => ({
    ...n,
    totalAmount: n.amount,
    noteDate: n.returnOrder?.returnDate ?? n.createdAt,
    reason: n.returnOrder?.reason,
    customer: n.returnOrder?.customer,
    supplier: n.returnOrder?.supplier,
  }));
  res.json(paginatedResponse(mapped, { page: +page, limit: +limit, total, totalPages: Math.ceil(total / +limit) }));
});

router.get('/credit-notes/:id', async (req: Request, res: Response) => {
  const note = await prisma.creditDebitNote.findFirst({
    where: { id: req.params.id, returnOrder: { organizationId: req.organizationId! } },
    include: { returnOrder: { include: { items: true, customer: true, supplier: true } } },
  });
  if (!note) throw new NotFoundError('Credit/Debit note', req.params.id);
  res.json(successResponse({ ...note, totalAmount: note.amount }));
});

router.post('/credit-notes/:id/confirm', async (req: Request, res: Response) => {
  const note = await prisma.creditDebitNote.findFirst({ where: { id: req.params.id, returnOrder: { organizationId: req.organizationId! } } });
  if (!note) throw new NotFoundError('Credit/Debit note', req.params.id);
  const updated = await prisma.creditDebitNote.update({ where: { id: note.id }, data: { status: 'OPEN' } });
  res.json(successResponse({ ...updated, confirmedAt: new Date() }, 'Note confirmed'));
});

router.post('/credit-notes/:id/cancel', async (req: Request, res: Response) => {
  const note = await prisma.creditDebitNote.findFirst({ where: { id: req.params.id, returnOrder: { organizationId: req.organizationId! } } });
  if (!note) throw new NotFoundError('Credit/Debit note', req.params.id);
  const updated = await prisma.creditDebitNote.update({ where: { id: note.id }, data: { status: 'CANCELLED' } });
  res.json(successResponse(updated, 'Note cancelled'));
});

export { router as returnRouter };
