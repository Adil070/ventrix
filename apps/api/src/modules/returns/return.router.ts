import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { cache, CacheService } from '../../infrastructure/cache';
import { successResponse, paginatedResponse, createdResponse, roundTo, toDecimal } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { NotFoundError, BadRequestError } from '../../shared/errors';
import { z } from 'zod';
import { Prisma, ReturnType } from '@prisma/client';
import { InventoryEngine, getWarehouseProductStock, lockProducts, resolveWarehouse } from '../inventory/inventory.engine';
import { nextSequenceNumber, retryOnUniqueViolation } from '../../shared/helpers/sequence';
import { AccountingEngine } from '../accounting/accounting.engine';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

const inventoryEngine = new InventoryEngine();
const accountingEngine = new AccountingEngine();

// ─── Schemas ────────────────────────────────────────────────────────────────
// Optional ids: '' (blank select) means "not set" instead of being written as a broken foreign key.
const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);
const optionalId = z.preprocess(blankToUndefined, z.string().min(1).optional());

const ReturnItemSchema = z.object({
  productId: optionalId,
  description: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  taxRate: z.coerce.number().min(0).max(100).default(0),
});

const CreateReturnSchema = z.object({
  type: z.enum(['SALES_RETURN', 'PURCHASE_RETURN']),
  invoiceId: optionalId,
  purchaseId: optionalId,
  customerId: optionalId,
  supplierId: optionalId,
  returnDate: z.coerce.date().default(() => new Date()),
  reason: z.string().optional(),
  notes: z.string().optional(),
  // Whether a credit/debit note is raised is decided when the return is approved (POST .../approve
  // { generateCreditNote }), because the return order has no column to remember it. `true` (the default
  // behaviour) is still accepted here for older clients; `false` is refused instead of being silently ignored.
  generateCreditNote: z.literal(true, {
    errorMap: () => ({ message: 'Pass generateCreditNote: false when approving the return (POST /returns/return-orders/:id/approve)' }),
  }).optional(),
  items: z.array(ReturnItemSchema).min(1),
});

const ApproveReturnSchema = z.object({
  generateCreditNote: z.boolean().default(true),
});

const CreateNoteSchema = z.object({
  type: z.enum(['CREDIT_NOTE', 'DEBIT_NOTE']),
  customerId: optionalId,
  supplierId: optionalId,
  returnOrderId: optionalId,
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

const ReturnListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  status: z.preprocess(blankToUndefined, z.enum(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'ADJUSTMENT']).optional()),
  type: z.preprocess(blankToUndefined, z.nativeEnum(ReturnType).optional()),
});

const NoteListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  type: z.preprocess(blankToUndefined, z.enum(['CREDIT_NOTE', 'DEBIT_NOTE']).optional()),
  status: z.preprocess(blankToUndefined, z.enum(['DRAFT', 'OPEN', 'ADJUSTED', 'CANCELLED']).optional()),
});

// Return statuses that still count against the invoiced/purchased quantity.
const OPEN_RETURN_STATUSES = ['DRAFT', 'PENDING', 'APPROVED'];
const APPROVABLE = ['DRAFT', 'PENDING'];

// ─── Helpers ────────────────────────────────────────────────────────────────
const NOTE_PREFIX = { SALES_RETURN: 'CN-', PURCHASE_RETURN: 'DN-' } as const;
const RETURN_PREFIX = { SALES_RETURN: 'SR-', PURCHASE_RETURN: 'PR-' } as const;

function calcItem(item: { quantity: number; unitPrice: number; taxRate?: number }) {
  const taxable = item.quantity * item.unitPrice;
  const taxAmount = (taxable * (item.taxRate || 0)) / 100;
  return { taxable, taxAmount, amount: taxable + taxAmount };
}

const sumByProduct = (rows: Array<{ productId: string | null; quantity: unknown }>) => {
  const m = new Map<string, number>();
  for (const r of rows) if (r.productId) m.set(r.productId, roundTo((m.get(r.productId) ?? 0) + toDecimal(r.quantity), 3));
  return m;
};

/** Validates every id a new return references against the caller's organization and fills defaults. */
async function validateReturnInput(organizationId: string, input: z.infer<typeof CreateReturnSchema>) {
  const isSale = input.type === 'SALES_RETURN';
  if (isSale && (input.purchaseId || input.supplierId)) {
    throw new BadRequestError('A sales return cannot reference a purchase or supplier');
  }
  if (!isSale && (input.invoiceId || input.customerId)) {
    throw new BadRequestError('A purchase return cannot reference an invoice or customer');
  }

  let customerId = input.customerId;
  let supplierId = input.supplierId;
  let sourceItems: Array<{ productId: string | null; quantity: unknown }> | null = null;
  let priorReturns: Array<{ productId: string | null; quantity: unknown }> = [];

  if (input.invoiceId) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: input.invoiceId, organizationId },
      select: { id: true, status: true, customerId: true, invoiceNumber: true, items: { select: { productId: true, quantity: true } } },
    });
    if (!invoice) throw new NotFoundError('Invoice', input.invoiceId);
    if (invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') {
      throw new BadRequestError(`Cannot return goods against a ${invoice.status} invoice`);
    }
    if (customerId && invoice.customerId && customerId !== invoice.customerId) {
      throw new BadRequestError(`Customer does not match invoice ${invoice.invoiceNumber}`);
    }
    customerId = customerId ?? invoice.customerId ?? undefined;
    sourceItems = invoice.items;
    priorReturns = await prisma.returnOrderItem.findMany({
      where: { returnOrder: { invoiceId: invoice.id, organizationId, status: { in: OPEN_RETURN_STATUSES } } },
      select: { productId: true, quantity: true },
    });
  }

  if (input.purchaseId) {
    const purchase = await prisma.purchase.findFirst({
      where: { id: input.purchaseId, organizationId },
      select: { id: true, status: true, supplierId: true, purchaseNumber: true, items: { select: { productId: true, quantity: true } } },
    });
    if (!purchase) throw new NotFoundError('Purchase', input.purchaseId);
    if (purchase.status === 'DRAFT' || purchase.status === 'CANCELLED') {
      throw new BadRequestError(`Cannot return goods against a ${purchase.status} purchase`);
    }
    if (supplierId && purchase.supplierId && supplierId !== purchase.supplierId) {
      throw new BadRequestError(`Supplier does not match purchase ${purchase.purchaseNumber}`);
    }
    supplierId = supplierId ?? purchase.supplierId ?? undefined;
    sourceItems = purchase.items;
    priorReturns = await prisma.returnOrderItem.findMany({
      where: { returnOrder: { purchaseId: purchase.id, organizationId, status: { in: OPEN_RETURN_STATUSES } } },
      select: { productId: true, quantity: true },
    });
  }

  const productIds = [...new Set(input.items.map((i) => i.productId).filter((x): x is string => !!x))];
  const [customer, supplier, products] = await Promise.all([
    customerId ? prisma.customer.count({ where: { id: customerId, organizationId } }) : 1,
    supplierId ? prisma.supplier.count({ where: { id: supplierId, organizationId } }) : 1,
    productIds.length ? prisma.product.findMany({ where: { id: { in: productIds }, organizationId }, select: { id: true, name: true } }) : [],
  ]);
  if (!customer) throw new NotFoundError('Customer', customerId);
  if (!supplier) throw new NotFoundError('Supplier', supplierId);
  if (products.length !== productIds.length) {
    const missing = productIds.find((id) => !products.some((p) => p.id === id));
    throw new NotFoundError('Product', missing);
  }

  // A return against a document cannot give back more than the document sold/bought.
  if (sourceItems) {
    const source = sumByProduct(sourceItems);
    const already = sumByProduct(priorReturns);
    const requested = sumByProduct(input.items.map((i) => ({ productId: i.productId ?? null, quantity: i.quantity })));
    for (const [productId, qty] of requested) {
      const name = products.find((p) => p.id === productId)?.name ?? productId;
      const max = source.get(productId);
      if (max === undefined) throw new BadRequestError(`${name} is not on the ${input.invoiceId ? 'invoice' : 'purchase'}`);
      const left = roundTo(max - (already.get(productId) ?? 0), 3);
      if (qty > left) throw new BadRequestError(`Only ${Math.max(0, left)} of ${name} can still be returned`);
    }
  }

  return { customerId, supplierId, productNames: new Map(products.map((p) => [p.id, p.name])) };
}

// ─── Return Orders ──────────────────────────────────────────────────────────
router.post('/return-orders', async (req: Request, res: Response) => {
  const input = CreateReturnSchema.parse(req.body);
  const organizationId = req.organizationId!;
  const { customerId, supplierId, productNames } = await validateReturnInput(organizationId, input);

  let totalAmount = 0;
  const itemsData = input.items.map((it) => {
    const c = calcItem(it);
    totalAmount += c.amount;
    return {
      productId: it.productId,
      description: it.description || (it.productId && productNames.get(it.productId)) || 'Returned item',
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      taxAmount: roundTo(c.taxAmount),
      amount: roundTo(c.amount),
    };
  });

  const created = await retryOnUniqueViolation('returnNumber', () => prisma.$transaction(async (tx) => {
    const returnNumber = await nextSequenceNumber(tx, organizationId, 'returnOrder', RETURN_PREFIX[input.type]);
    return tx.returnOrder.create({
      data: {
        organizationId,
        returnNumber,
        returnType: input.type,
        invoiceId: input.invoiceId,
        purchaseId: input.purchaseId,
        customerId,
        supplierId,
        returnDate: input.returnDate,
        status: 'PENDING',
        totalAmount: roundTo(totalAmount),
        reason: input.reason,
        notes: input.notes,
        createdBy: req.userId,
        items: { create: itemsData },
      },
      include: { items: true, customer: { select: { name: true } }, supplier: { select: { name: true } } },
    });
  }));

  res.status(201).json(createdResponse(created, 'Return order created'));
});

router.get('/return-orders', async (req: Request, res: Response) => {
  const { page, limit, status, type } = ReturnListQuery.parse(req.query);
  const where: Prisma.ReturnOrderWhereInput = {
    organizationId: req.organizationId!,
    ...(status && { status }),
    ...(type && { returnType: type }),
  };
  const [data, total] = await Promise.all([
    prisma.returnOrder.findMany({
      where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' },
      include: { customer: { select: { name: true } }, supplier: { select: { name: true } }, _count: { select: { items: true } } },
    }),
    prisma.returnOrder.count({ where }),
  ]);
  // Map returnType -> type and returnNumber -> returnOrderNumber for FE compatibility
  const mapped = data.map((r) => ({ ...r, type: r.returnType, returnOrderNumber: r.returnNumber }));
  res.json(paginatedResponse(mapped, { page, limit, total, totalPages: Math.ceil(total / limit) }));
});

router.get('/return-orders/:id', async (req: Request, res: Response) => {
  const r = await prisma.returnOrder.findFirst({
    where: { id: req.params.id, organizationId: req.organizationId! },
    include: { items: { include: { product: { select: { name: true } } } }, customer: true, supplier: true, creditDebitNotes: true },
  });
  if (!r) throw new NotFoundError('Return order', req.params.id);
  res.json(successResponse({ ...r, type: r.returnType, returnOrderNumber: r.returnNumber }));
});

/**
 * Approving a return moves the stock (sales return: back in as SALE_RETURN; purchase return: out as
 * PURCHASE_RETURN) and, unless generateCreditNote is false, raises a credit note (sales) / debit note
 * (purchase) for the return total and settles it against the linked document:
 *  - sales return on an invoice with a balance: the invoice balance drops by min(credit, balance) and its
 *    status becomes PAID (balance 0) or PARTIALLY_PAID (OVERDUE stays OVERDUE while a balance remains);
 *  - purchase return on a purchase: purchase.balanceAmount drops the same way (status untouched);
 *  - whatever is not needed (e.g. the invoice was already fully paid) stays on the note as open credit:
 *    note.status OPEN with adjustedAmount < amount; a fully used note is ADJUSTED.
 */
router.post('/return-orders/:id/approve', async (req: Request, res: Response) => {
  const organizationId = req.organizationId!;
  const { generateCreditNote } = ApproveReturnSchema.parse(req.body ?? {});
  const ret = await prisma.returnOrder.findFirst({ where: { id: req.params.id, organizationId }, include: { items: true } });
  if (!ret) throw new NotFoundError('Return order', req.params.id);
  if (!APPROVABLE.includes(ret.status)) {
    throw new BadRequestError(ret.status === 'APPROVED' ? 'Return order already approved' : `Cannot approve a return order in ${ret.status} status`);
  }

  const isSale = ret.returnType === 'SALES_RETURN';

  const result = await prisma.$transaction(async (tx) => {
    // Conditional switch: a concurrent approve/reject makes this match nothing, so stock moves only once.
    const { count } = await tx.returnOrder.updateMany({
      where: { id: ret.id, organizationId, status: { in: APPROVABLE } },
      data: { status: 'APPROVED' },
    });
    if (count !== 1) throw new BadRequestError('Return order was already processed');

    // Stock (inventory-tracked products only — entries and openingStock always move together): a sales
    // return goes back into the warehouse the sale left from, a purchase return leaves the warehouse the
    // purchase went into (default warehouse otherwise). A purchase return may not take a warehouse below zero.
    const sourceRef = isSale ? ret.invoiceId : ret.purchaseId;
    const productIds = [...new Set(ret.items.map((i) => i.productId).filter((x): x is string => !!x))];
    const tracked = new Map(
      (await tx.product.findMany({ where: { id: { in: productIds }, organizationId, trackInventory: true }, select: { id: true, name: true } }))
        .map((p) => [p.id, p.name]),
    );
    await lockProducts(tx, [...tracked.keys()]);

    const moves: Array<{ productId: string; warehouseId: string; qty: number; rate: number }> = [];
    for (const item of ret.items) {
      if (!item.productId || !tracked.has(item.productId)) continue;
      const original = sourceRef
        ? await tx.stockEntry.findFirst({
            where: { referenceId: sourceRef, productId: item.productId, movementType: isSale ? 'SALE' : 'PURCHASE', warehouse: { organizationId, isActive: true } },
            select: { warehouseId: true },
          })
        : null;
      const warehouseId = original?.warehouseId ?? (await resolveWarehouse(tx, organizationId)).id;
      moves.push({ productId: item.productId, warehouseId, qty: toDecimal(item.quantity), rate: toDecimal(item.unitPrice) });
    }

    if (!isSale) {
      const needed = new Map<string, { productId: string; warehouseId: string; qty: number }>();
      for (const m of moves) {
        const key = `${m.productId}:${m.warehouseId}`;
        const cur = needed.get(key) ?? { productId: m.productId, warehouseId: m.warehouseId, qty: 0 };
        cur.qty = roundTo(cur.qty + m.qty, 3);
        needed.set(key, cur);
      }
      for (const n of needed.values()) {
        const onHand = await getWarehouseProductStock(tx, organizationId, n.productId, n.warehouseId);
        if (onHand < n.qty) {
          throw new BadRequestError(`Insufficient stock to return ${n.qty} of ${tracked.get(n.productId)}: only ${Math.max(0, onHand)} in the warehouse`);
        }
      }
    }

    for (const m of moves) {
      const delta = isSale ? m.qty : -m.qty;
      await tx.product.update({ where: { id: m.productId }, data: { openingStock: { increment: delta } } });
      await inventoryEngine.recordStockMovement(tx, {
        organizationId, warehouseId: m.warehouseId, productId: m.productId,
        movementType: isSale ? 'SALE_RETURN' : 'PURCHASE_RETURN',
        quantity: delta, rate: m.rate,
        referenceType: 'RETURN_ORDER', referenceId: ret.id, createdBy: req.userId,
      });
    }

    if (!generateCreditNote) return { note: null, applied: 0 };

    // Settle the note against the linked invoice / purchase.
    const amount = toDecimal(ret.totalAmount);
    let applied = 0;
    let appliedTo: string | null = null;
    if (isSale && ret.invoiceId) {
      const inv = await tx.invoice.findFirst({ where: { id: ret.invoiceId, organizationId } });
      const balance = toDecimal(inv?.balanceAmount);
      if (inv && ['CONFIRMED', 'PARTIALLY_PAID', 'OVERDUE'].includes(inv.status) && balance > 0) {
        applied = roundTo(Math.min(amount, balance));
        const newBalance = roundTo(balance - applied);
        const status = newBalance <= 0 ? 'PAID' : inv.status === 'OVERDUE' ? 'OVERDUE' : 'PARTIALLY_PAID';
        const upd = await tx.invoice.updateMany({
          where: { id: inv.id, organizationId, balanceAmount: inv.balanceAmount, status: inv.status },
          data: { balanceAmount: newBalance, status },
        });
        if (upd.count !== 1) throw new BadRequestError('Invoice changed while approving the return; try again');
        appliedTo = inv.invoiceNumber;
      }
    } else if (!isSale && ret.purchaseId) {
      const pur = await tx.purchase.findFirst({ where: { id: ret.purchaseId, organizationId } });
      const balance = toDecimal(pur?.balanceAmount);
      if (pur && pur.status !== 'CANCELLED' && balance > 0) {
        applied = roundTo(Math.min(amount, balance));
        const upd = await tx.purchase.updateMany({
          where: { id: pur.id, organizationId, balanceAmount: pur.balanceAmount },
          data: { balanceAmount: roundTo(balance - applied) },
        });
        if (upd.count !== 1) throw new BadRequestError('Purchase changed while approving the return; try again');
        appliedTo = pur.purchaseNumber;
      }
    }

    const noteNumber = await nextSequenceNumber(tx, organizationId, 'creditDebitNote', NOTE_PREFIX[ret.returnType]);
    const note = await tx.creditDebitNote.create({
      data: {
        returnOrderId: ret.id,
        noteNumber,
        type: isSale ? 'CREDIT_NOTE' : 'DEBIT_NOTE',
        amount: ret.totalAmount,
        adjustedAmount: applied,
        status: applied >= amount && amount > 0 ? 'ADJUSTED' : 'OPEN',
        notes: `Auto-generated for return ${ret.returnNumber}` + (appliedTo ? `; ${applied.toFixed(2)} adjusted against ${appliedTo}` : ''),
      },
    });

    // Post the note to the ledger so Receivables/Payables, Sales/Purchases and GST match the settled balances.
    // GST is split like the original document: IGST if it was inter-state, otherwise CGST + SGST.
    const taxAmount = roundTo(ret.items.reduce((sum, i) => sum + toDecimal(i.taxAmount), 0));
    if (isSale) {
      const source = ret.invoiceId ? await tx.invoice.findFirst({ where: { id: ret.invoiceId, organizationId }, select: { igstAmount: true } }) : null;
      await accountingEngine.postCreditNoteEntry(tx, note, { taxAmount, interState: toDecimal(source?.igstAmount) > 0, invoiceId: ret.invoiceId }, organizationId);
    } else {
      const source = ret.purchaseId ? await tx.purchase.findFirst({ where: { id: ret.purchaseId, organizationId }, select: { igstAmount: true } }) : null;
      await accountingEngine.postDebitNoteEntry(tx, note, { taxAmount, interState: toDecimal(source?.igstAmount) > 0, purchaseId: ret.purchaseId }, organizationId);
    }

    return { note, applied };
  }, { maxWait: 10000, timeout: 30000 });

  await cache.del(CacheService.keys.dashboardStats(organizationId));

  const updated = await prisma.returnOrder.findFirst({ where: { id: ret.id, organizationId } });
  res.json(successResponse({ ...updated, approvedAt: new Date(), creditNote: result.note, adjustedAmount: result.applied }, 'Return order approved'));
});

router.post('/return-orders/:id/reject', async (req: Request, res: Response) => {
  const ret = await prisma.returnOrder.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! } });
  if (!ret) throw new NotFoundError('Return order', req.params.id);
  const { count } = await prisma.returnOrder.updateMany({
    where: { id: ret.id, organizationId: req.organizationId!, status: { in: APPROVABLE } },
    data: { status: 'REJECTED' },
  });
  if (count !== 1) throw new BadRequestError(`Cannot reject a return order in ${ret.status} status`);
  res.json(successResponse({ ...ret, status: 'REJECTED' }, 'Return order rejected'));
});

// ─── Credit / Debit Notes ─────────────────────────────────────────────────────
router.post('/credit-notes', async (req: Request, res: Response) => {
  const input = CreateNoteSchema.parse(req.body);
  const organizationId = req.organizationId!;
  const isCredit = input.type === 'CREDIT_NOTE';
  const returnType = isCredit ? 'SALES_RETURN' : 'PURCHASE_RETURN';

  if (isCredit && input.supplierId) throw new BadRequestError('A credit note is issued to a customer, not a supplier');
  if (!isCredit && input.customerId) throw new BadRequestError('A debit note is issued to a supplier, not a customer');

  const [customer, supplier, linked] = await Promise.all([
    input.customerId ? prisma.customer.count({ where: { id: input.customerId, organizationId } }) : 1,
    input.supplierId ? prisma.supplier.count({ where: { id: input.supplierId, organizationId } }) : 1,
    input.returnOrderId ? prisma.returnOrder.findFirst({ where: { id: input.returnOrderId, organizationId }, select: { id: true, returnType: true } }) : null,
  ]);
  if (!customer) throw new NotFoundError('Customer', input.customerId);
  if (!supplier) throw new NotFoundError('Supplier', input.supplierId);
  if (input.returnOrderId && !linked) throw new NotFoundError('Return order', input.returnOrderId);
  if (linked && linked.returnType !== returnType) {
    throw new BadRequestError(`A ${isCredit ? 'credit' : 'debit'} note must be linked to a ${isCredit ? 'sales' : 'purchase'} return`);
  }

  let amount = 0;
  for (const it of input.items) amount += calcItem(it).amount;
  amount = roundTo(amount);

  const note = await retryOnUniqueViolation('returnNumber', () => prisma.$transaction(async (tx) => {
    // CreditDebitNote requires a returnOrderId. If none provided, create a backing
    // adjustment return order so standalone notes are supported.
    let returnOrderId = input.returnOrderId;
    if (!returnOrderId) {
      const returnNumber = await nextSequenceNumber(tx, organizationId, 'returnOrder', 'ADJ-');
      const backing = await tx.returnOrder.create({
        data: {
          organizationId,
          returnNumber,
          returnType,
          customerId: input.customerId,
          supplierId: input.supplierId,
          returnDate: input.noteDate,
          status: 'ADJUSTMENT',
          totalAmount: amount,
          reason: input.reason,
          notes: input.notes,
          createdBy: req.userId,
          items: { create: input.items.map((it) => { const c = calcItem(it); return { description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, taxAmount: roundTo(c.taxAmount), amount: roundTo(c.amount) }; }) },
        },
      });
      returnOrderId = backing.id;
    }

    const noteNumber = await nextSequenceNumber(tx, organizationId, 'creditDebitNote', isCredit ? 'CN-' : 'DN-');
    return tx.creditDebitNote.create({
      data: { returnOrderId, noteNumber, type: input.type, amount, status: 'DRAFT', notes: input.notes },
      include: { returnOrder: { select: { customerId: true, supplierId: true, customer: { select: { name: true } }, supplier: { select: { name: true } } } } },
    });
  }));

  res.status(201).json(createdResponse({ ...note, noteDate: input.noteDate, reason: input.reason, totalAmount: amount, customer: note.returnOrder?.customer, supplier: note.returnOrder?.supplier }, 'Note created'));
});

router.get('/credit-notes', async (req: Request, res: Response) => {
  const { page, limit, type, status } = NoteListQuery.parse(req.query);
  const where: Prisma.CreditDebitNoteWhereInput = {
    returnOrder: { organizationId: req.organizationId! },
    ...(type && { type }),
    ...(status && { status }),
  };
  const [data, total] = await Promise.all([
    prisma.creditDebitNote.findMany({
      where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' },
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
  res.json(paginatedResponse(mapped, { page, limit, total, totalPages: Math.ceil(total / limit) }));
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
  if (note.status !== 'DRAFT') throw new BadRequestError(`Cannot confirm a note in ${note.status} status`);
  const updated = await prisma.creditDebitNote.update({ where: { id: note.id }, data: { status: 'OPEN' } });
  res.json(successResponse({ ...updated, confirmedAt: new Date() }, 'Note confirmed'));
});

router.post('/credit-notes/:id/cancel', async (req: Request, res: Response) => {
  const note = await prisma.creditDebitNote.findFirst({ where: { id: req.params.id, returnOrder: { organizationId: req.organizationId! } } });
  if (!note) throw new NotFoundError('Credit/Debit note', req.params.id);
  if (note.status === 'CANCELLED') throw new BadRequestError('Note is already cancelled');
  if (toDecimal(note.adjustedAmount) > 0) throw new BadRequestError('Cannot cancel a note that has been adjusted against an invoice or bill');
  // Cancel and reverse its ledger entry together, so receivables/payables and the GST adjustment go back too.
  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.creditDebitNote.updateMany({ where: { id: note.id, status: { not: 'CANCELLED' }, adjustedAmount: 0 }, data: { status: 'CANCELLED' } });
    if (count !== 1) throw new BadRequestError('Note was changed by someone else; reload and try again');
    await accountingEngine.reverseEntries(tx, req.organizationId!, { referenceType: note.type, referenceId: note.id }, new Date(), `note ${note.noteNumber} cancelled`);
    return tx.creditDebitNote.findFirst({ where: { id: note.id } });
  });
  res.json(successResponse(updated, 'Note cancelled'));
});

export { router as returnRouter };
