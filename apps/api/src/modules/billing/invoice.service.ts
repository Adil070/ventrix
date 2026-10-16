import { Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database';
import { cache, CacheService } from '../../infrastructure/cache';
import { NotFoundError, BadRequestError } from '../../shared/errors';
import { roundTo, toDecimal } from '../../shared/helpers/response.helper';
import { nextSequenceNumber, retryOnUniqueViolation } from '../../shared/helpers/sequence';
import type { CreateInvoiceInput, UpdateInvoiceInput, InvoiceQueryInput, RecordPaymentInput } from './invoice.dto';
import { AccountingEngine } from '../accounting/accounting.engine';
import { InventoryEngine, lockProducts, resolveWarehouse } from '../inventory/inventory.engine';

export class InvoiceService {
  private readonly accountingEngine = new AccountingEngine();
  private readonly inventoryEngine = new InventoryEngine();

  // ─── Create Invoice ───────────────────────────────────────────────────────────
  /**
   * Single code path for every invoice (POST /invoices, quotation and sales-order conversion): numbering,
   * totals/GST, stock deduction, journal entry and dashboard cache. `options.onCreated` runs inside the same
   * transaction, so callers can link/mark their source document atomically (throwing rolls everything back).
   * Invoice creation is serialised per org by the numbering lock, so `beforeCreate` sees committed state of
   * any concurrent conversion of the same source document.
   */
  async createInvoice(
    organizationId: string,
    branchId: string | undefined,
    userId: string,
    input: CreateInvoiceInput,
    options: {
      /** Runs in the transaction after the per-org invoice-number lock is taken, before the invoice is written. */
      beforeCreate?: (tx: Prisma.TransactionClient) => Promise<void>;
      /** Runs in the transaction after the invoice (and its stock/journal postings) is written. */
      onCreated?: (tx: Prisma.TransactionClient, invoice: { id: string; invoiceNumber: string }) => Promise<void>;
    } = {},
  ) {
    await this.assertReferencesBelongToOrg(organizationId, input);

    // Calculate totals
    const calculated = this.calculateInvoiceTotals(input);

    // Determine initial status - auto-confirm if requested
    const autoConfirm = (input as any).autoConfirm ?? false;
    const initialStatus = autoConfirm ? 'CONFIRMED' : 'DRAFT';

    // The number is allocated inside the transaction under a per-org lock; the retry only covers rows
    // written by code paths that bypass the lock.
    const invoice = await retryOnUniqueViolation('invoiceNumber', () => prisma.$transaction(async (tx) => {
      const invoiceNumber = await this.getNextInvoiceNumber(tx, organizationId);
      if (options.beforeCreate) await options.beforeCreate(tx);

      // Create invoice
      const created = await tx.invoice.create({
        data: {
          organizationId,
          branchId,
          customerId: input.customerId,
          salesOrderId: input.salesOrderId,
          invoiceNumber,
          invoiceType: input.invoiceType as any,
          status: initialStatus,
          invoiceDate: input.invoiceDate,
          dueDate: input.dueDate,
          supplyDate: input.supplyDate,
          placeOfSupply: input.placeOfSupply,
          currency: input.currency,
          exchangeRate: input.exchangeRate,
          subtotal: calculated.subtotal,
          discountType: input.discountType,
          discountValue: input.discountValue,
          discountAmount: calculated.discountAmount,
          taxableAmount: calculated.taxableAmount,
          cgstAmount: calculated.cgstAmount,
          sgstAmount: calculated.sgstAmount,
          igstAmount: calculated.igstAmount,
          taxAmount: calculated.taxAmount,
          shippingCharges: input.shippingCharges,
          roundOff: input.roundOff,
          totalAmount: calculated.totalAmount,
          balanceAmount: calculated.totalAmount,
          termsAndConditions: input.termsAndConditions,
          notes: input.notes,
          billingAddress: input.billingAddress as Prisma.InputJsonValue,
          shippingAddress: input.shippingAddress as Prisma.InputJsonValue,
          reverseCharge: input.reverseCharge,
          isExport: input.isExport,
          exportType: input.exportType,
          couponId: input.couponId,
          templateId: input.templateId,
          createdBy: userId,
          items: {
            create: input.items.map((item, idx) => {
              const itemCalc = this.calculateItemAmounts(item);
              return {
                productId: item.productId,
                variantId: item.variantId,
                taxRateId: item.taxRateId,
                description: item.description,
                hsnCode: item.hsnCode,
                sacCode: item.sacCode,
                quantity: item.quantity,
                unit: item.unit,
                unitPrice: item.unitPrice,
                discountType: item.discountType,
                discountValue: item.discountValue,
                discountAmount: itemCalc.discountAmount,
                taxableAmount: itemCalc.taxableAmount,
                taxRate: item.taxRate,
                cgstRate: item.cgstRate,
                sgstRate: item.sgstRate,
                igstRate: item.igstRate,
                cgstAmount: itemCalc.cgstAmount,
                sgstAmount: itemCalc.sgstAmount,
                igstAmount: itemCalc.igstAmount,
                taxAmount: itemCalc.taxAmount,
                amount: itemCalc.amount,
                batchNumber: item.batchNumber,
                serialNumbers: item.serialNumbers || [],
                warehouseId: item.warehouseId,
                sortOrder: item.sortOrder || idx,
              };
            }),
          },
        },
        include: {
          items: true,
          customer: true,
          branch: true,
        },
      });

      // If auto-confirm, handle accounting and inventory
      if (autoConfirm) {
        // Post journal entries
        await this.accountingEngine.postSalesEntry(tx, created as any, organizationId);

        // Update inventory
        await this.deductStockForInvoice(tx, organizationId, created.id, created.items, userId);

        // Update sales order if linked
        if (created.salesOrderId) {
          await this.updateSalesOrderFulfillment(tx, created.salesOrderId, created.items);
        }
      }

      if (options.onCreated) await options.onCreated(tx, created);

      return created;
    }, { maxWait: 10000, timeout: 30000 }));

    // Invalidate dashboard cache
    await cache.del(CacheService.keys.dashboardStats(organizationId));

    return invoice;
  }

  // ─── Confirm Invoice (post to accounting & update inventory) ──────────────────
  async confirmInvoice(organizationId: string, invoiceId: string, userId: string) {
    const invoice = await this.getInvoiceOrThrow(invoiceId, organizationId);

    if (invoice.status !== 'DRAFT') {
      throw new BadRequestError(`Invoice is already in ${invoice.status} status`);
    }

    await prisma.$transaction(async (tx) => {
      // Conditional update: a concurrent confirm/cancel makes this match 0 rows instead of posting twice.
      const { count } = await tx.invoice.updateMany({
        where: { id: invoiceId, organizationId, status: 'DRAFT' },
        data: { status: 'CONFIRMED' },
      });
      if (count !== 1) throw new BadRequestError('Invoice is no longer in DRAFT status');

      // Post journal entries
      await this.accountingEngine.postSalesEntry(tx, invoice as any, organizationId);

      // Update inventory
      await this.deductStockForInvoice(tx, organizationId, invoiceId, invoice.items, userId);

      // Update sales order if linked
      if (invoice.salesOrderId) {
        await this.updateSalesOrderFulfillment(tx, invoice.salesOrderId, invoice.items);
      }
    }, { maxWait: 10000, timeout: 30000 });

    await cache.del(CacheService.keys.dashboardStats(organizationId));

    return { message: 'Invoice confirmed successfully' };
  }

  // ─── Record Payment ───────────────────────────────────────────────────────────
  async recordPayment(organizationId: string, invoiceId: string, userId: string, input: RecordPaymentInput) {
    const invoice = await this.getInvoiceOrThrow(invoiceId, organizationId);

    if (invoice.status === 'CANCELLED') {
      throw new BadRequestError('Cannot record payment for cancelled invoice');
    }

    if (toDecimal(invoice.balanceAmount) <= 0) {
      throw new BadRequestError('Invoice is already fully paid');
    }

    if (input.bankAccountId && !(await prisma.bankAccount.count({ where: { id: input.bankAccountId, organizationId } }))) {
      throw new NotFoundError('Bank account', input.bankAccountId);
    }

    const paymentAmount = Math.min(input.amount, toDecimal(invoice.balanceAmount));
    const newBalance = roundTo(toDecimal(invoice.balanceAmount) - paymentAmount);
    const newPaid = roundTo(toDecimal(invoice.paidAmount) + paymentAmount);
    const newStatus = newBalance <= 0 ? 'PAID' : 'PARTIALLY_PAID';

    const payment = await prisma.$transaction(async (tx) => {
      // Re-check the balance we computed from: a concurrent payment/credit makes this match nothing.
      const { count } = await tx.invoice.updateMany({
        where: { id: invoiceId, organizationId, balanceAmount: invoice.balanceAmount, status: { not: 'CANCELLED' } },
        data: {
          paidAmount: newPaid,
          balanceAmount: newBalance,
          status: newStatus,
        },
      });
      if (count !== 1) throw new BadRequestError('Invoice changed while recording the payment; reload and try again');

      // Same per-org PAY-00001 sequence as the payments module (max-based under an advisory lock).
      const paymentNumber = await nextSequenceNumber(tx, organizationId, 'payment', 'PAY-', 5);

      // Create payment
      const pay = await tx.payment.create({
        data: {
          organizationId,
          invoiceId,
          customerId: invoice.customerId || undefined,
          paymentNumber,
          type: 'RECEIPT',
          mode: input.mode as any,
          amount: paymentAmount,
          currency: invoice.currency,
          paymentDate: input.paymentDate,
          referenceNumber: input.referenceNumber,
          bankAccountId: input.bankAccountId,
          transactionId: input.transactionId,
          upiId: input.upiId,
          notes: input.notes,
          createdBy: userId,
        },
      });

      // Post payment journal entry
      await this.accountingEngine.postReceiptEntry(tx, pay as any, invoice as any, organizationId);

      return pay;
    }, { maxWait: 10000, timeout: 30000 });

    await cache.del(CacheService.keys.dashboardStats(organizationId));

    return payment;
  }

  // ─── Cancel Invoice ───────────────────────────────────────────────────────────
  /**
   * Policy: only invoices without money against them can be cancelled. If payments were recorded or a
   * return was raised against the invoice, cancelling would leave receipts/credit notes pointing at a void
   * document, so we refuse (400) and the user must issue a credit note / sales return instead.
   * Cancelling a confirmed invoice puts its stock back (positive stock entries + product.openingStock) and
   * posts a reversing journal entry. The DRAFT/CONFIRMED -> CANCELLED switch is a conditional update, so
   * the reversal can never run twice.
   */
  async cancelInvoice(organizationId: string, invoiceId: string, reason: string, userId?: string) {
    const invoice = await this.getInvoiceOrThrow(invoiceId, organizationId);

    if (invoice.status === 'CANCELLED') {
      throw new BadRequestError('Invoice is already cancelled');
    }

    if (invoice.status === 'PAID') {
      throw new BadRequestError('Cannot cancel a paid invoice. Create a credit note instead.');
    }

    const [paymentCount, returnCount] = await Promise.all([
      prisma.payment.count({ where: { invoiceId, status: { notIn: ['FAILED', 'REFUNDED'] } } }),
      prisma.returnOrder.count({ where: { organizationId, invoiceId, status: { not: 'REJECTED' } } }),
    ]);
    if (paymentCount > 0 || toDecimal(invoice.paidAmount) > 0) {
      throw new BadRequestError('Cannot cancel an invoice with recorded payments. Create a credit note (sales return) instead.');
    }
    if (returnCount > 0) {
      throw new BadRequestError('Cannot cancel an invoice that has sales returns raised against it.');
    }

    await prisma.$transaction(async (tx) => {
      const { count } = await tx.invoice.updateMany({
        where: { id: invoiceId, organizationId, status: invoice.status },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason },
      });
      if (count !== 1) throw new BadRequestError('Invoice was modified by another request; reload and try again');

      if (invoice.status === 'DRAFT') return; // nothing was posted for a draft

      // Put back the stock this invoice took out: one reversing entry per SALE entry it wrote (so legacy
      // entries of untracked products are netted too); openingStock only moves for tracked products, which
      // are the ones whose openingStock was decremented.
      const saleEntries = await tx.stockEntry.findMany({
        where: { referenceType: 'INVOICE', referenceId: invoiceId, movementType: 'SALE' },
      });
      await lockProducts(tx, saleEntries.map((e) => e.productId));
      for (const entry of saleEntries) {
        const qty = -toDecimal(entry.quantity); // sale entries are negative
        if (qty <= 0) continue;
        const product = await tx.product.findFirst({
          where: { id: entry.productId, organizationId },
          select: { trackInventory: true },
        });
        if (product?.trackInventory) {
          await tx.product.update({ where: { id: entry.productId }, data: { openingStock: { increment: qty } } });
        }
        await this.inventoryEngine.recordStockMovement(tx, {
          organizationId,
          warehouseId: entry.warehouseId,
          productId: entry.productId,
          variantId: entry.variantId || undefined,
          batchLotId: entry.batchLotId || undefined,
          movementType: 'ADJUSTMENT_IN',
          quantity: qty,
          rate: toDecimal(entry.rate),
          referenceType: 'INVOICE_CANCEL',
          referenceId: invoiceId,
          notes: `Invoice ${invoice.invoiceNumber} cancelled`,
          createdBy: userId,
        });
      }

      // Reverse the sales journal entry (swap debits/credits) so the ledger nets to zero.
      const entries = await tx.journalEntry.findMany({
        where: { organizationId, invoiceId, referenceType: 'INVOICE', isPosted: true },
        include: { lines: true },
      });
      for (const je of entries) {
        await tx.journalEntry.create({
          data: {
            organizationId,
            entryNumber: `${je.entryNumber}-REV`,
            type: je.type,
            referenceType: 'INVOICE_CANCEL',
            referenceId: invoiceId,
            invoiceId,
            date: new Date(),
            description: `Reversal of ${je.entryNumber} (invoice ${invoice.invoiceNumber} cancelled)`,
            totalDebit: je.totalCredit,
            totalCredit: je.totalDebit,
            isPosted: true,
            postedAt: new Date(),
            createdBy: userId,
            lines: {
              create: je.lines.map((l) => ({
                accountId: l.accountId,
                costCenterId: l.costCenterId,
                description: `Reversal: ${l.description ?? ''}`.trim(),
                debitAmount: l.creditAmount,
                creditAmount: l.debitAmount,
                currency: l.currency,
                exchangeRate: l.exchangeRate,
                sortOrder: l.sortOrder,
              })),
            },
          },
        });
      }

      // A quotation converted into this invoice can be converted again.
      await tx.quotation.updateMany({
        where: { organizationId, convertedToInvoiceId: invoiceId, status: 'CONVERTED' },
        data: { status: 'ACCEPTED', convertedToInvoiceId: null },
      });

      // Give the invoiced quantities back to the sales order.
      if (invoice.salesOrderId) {
        await this.releaseSalesOrderFulfillment(tx, invoice.salesOrderId, invoice.items);
      }
    }, { maxWait: 10000, timeout: 30000 });

    await cache.del(CacheService.keys.dashboardStats(organizationId));

    return { message: 'Invoice cancelled successfully' };
  }

  // ─── Get Invoices (list) ──────────────────────────────────────────────────────
  async getInvoices(organizationId: string, query: InvoiceQueryInput) {
    const { page, limit, status, customerId, fromDate, toDate, search, sortBy, sortOrder } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.InvoiceWhereInput = {
      organizationId,
      ...(status && { status: status as any }),
      ...(customerId && { customerId }),
      ...(fromDate && toDate && { invoiceDate: { gte: fromDate, lte: toDate } }),
      ...(search && {
        OR: [
          { invoiceNumber: { contains: search, mode: 'insensitive' } },
          { customer: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          customer: { select: { id: true, name: true, phone: true, email: true, gstin: true } },
          branch: { select: { id: true, name: true } },
          _count: { select: { items: true, payments: true } },
        },
      }),
      prisma.invoice.count({ where }),
    ]);

    return {
      data: invoices,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPreviousPage: page > 1,
      },
    };
  }

  // ─── Get Single Invoice ───────────────────────────────────────────────────────
  async getInvoice(organizationId: string, invoiceId: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: {
        customer: true,
        branch: true,
        items: {
          include: { product: true, variant: true },
          orderBy: { sortOrder: 'asc' },
        },
        payments: {
          orderBy: { paymentDate: 'desc' },
        },
        documents: true,
        salesOrder: { select: { id: true, orderNumber: true } },
      },
    });

    if (!invoice) throw new NotFoundError('Invoice', invoiceId);

    return invoice;
  }

  // ─── Outstanding Invoices ─────────────────────────────────────────────────────
  async getOutstandingInvoices(organizationId: string, customerId?: string) {
    return prisma.invoice.findMany({
      where: {
        organizationId,
        ...(customerId && { customerId }),
        status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'OVERDUE'] },
        balanceAmount: { gt: 0 },
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  // ─── Dashboard Stats ──────────────────────────────────────────────────────────
  async getInvoiceStats(organizationId: string, period: { from: Date; to: Date }) {
    const [totalRevenue, invoiceCount, paidCount, overdueInvoices] = await Promise.all([
      prisma.invoice.aggregate({
        where: {
          organizationId,
          status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] },
          invoiceDate: { gte: period.from, lte: period.to },
        },
        _sum: { totalAmount: true, paidAmount: true, balanceAmount: true },
        _count: true,
      }),
      prisma.invoice.count({
        where: { organizationId, invoiceDate: { gte: period.from, lte: period.to } },
      }),
      prisma.invoice.count({
        where: { organizationId, status: 'PAID', invoiceDate: { gte: period.from, lte: period.to } },
      }),
      prisma.invoice.findMany({
        where: {
          organizationId,
          status: { in: ['CONFIRMED', 'PARTIALLY_PAID'] },
          dueDate: { lt: new Date() },
        },
        select: { id: true, invoiceNumber: true, balanceAmount: true, dueDate: true, customer: { select: { name: true } } },
        orderBy: { dueDate: 'asc' },
        take: 10,
      }),
    ]);

    return {
      totalRevenue: toDecimal(totalRevenue._sum.totalAmount),
      totalPaid: toDecimal(totalRevenue._sum.paidAmount),
      totalOutstanding: toDecimal(totalRevenue._sum.balanceAmount),
      invoiceCount,
      paidCount,
      overdueCount: overdueInvoices.length,
      overdueInvoices,
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────
  private calculateItemAmounts(item: any) {
    const unitPrice = toDecimal(item.unitPrice);
    const quantity = toDecimal(item.quantity);
    const grossAmount = roundTo(unitPrice * quantity);

    let discountAmount = 0;
    if (item.discountType === 'PERCENTAGE') {
      discountAmount = roundTo((grossAmount * toDecimal(item.discountValue)) / 100);
    } else {
      discountAmount = toDecimal(item.discountValue);
    }

    const taxableAmount = roundTo(grossAmount - discountAmount);
    const cgstAmount = roundTo((taxableAmount * toDecimal(item.cgstRate)) / 100);
    const sgstAmount = roundTo((taxableAmount * toDecimal(item.sgstRate)) / 100);
    const igstAmount = roundTo((taxableAmount * toDecimal(item.igstRate)) / 100);
    const taxAmount = roundTo(cgstAmount + sgstAmount + igstAmount);
    const amount = roundTo(taxableAmount + taxAmount);

    return { discountAmount, taxableAmount, cgstAmount, sgstAmount, igstAmount, taxAmount, amount };
  }

  private calculateInvoiceTotals(input: CreateInvoiceInput) {
    let subtotal = 0;
    let taxableAmount = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;
    let taxAmount = 0;

    for (const item of input.items) {
      const calc = this.calculateItemAmounts(item);
      subtotal += roundTo(toDecimal(item.unitPrice) * toDecimal(item.quantity));
      taxableAmount += calc.taxableAmount;
      cgstAmount += calc.cgstAmount;
      sgstAmount += calc.sgstAmount;
      igstAmount += calc.igstAmount;
      taxAmount += calc.taxAmount;
    }

    subtotal = roundTo(subtotal);
    taxableAmount = roundTo(taxableAmount);
    cgstAmount = roundTo(cgstAmount);
    sgstAmount = roundTo(sgstAmount);
    igstAmount = roundTo(igstAmount);
    taxAmount = roundTo(taxAmount);

    let discountAmount = 0;
    if (input.discountType === 'PERCENTAGE') {
      discountAmount = roundTo((subtotal * toDecimal(input.discountValue)) / 100);
    } else {
      discountAmount = toDecimal(input.discountValue);
    }

    const totalAmount = roundTo(
      taxableAmount - discountAmount + taxAmount + toDecimal(input.shippingCharges) + toDecimal(input.roundOff)
    );

    return { subtotal, discountAmount, taxableAmount, cgstAmount, sgstAmount, igstAmount, taxAmount, totalAmount };
  }

  /**
   * Next number of the org's invoice sequence (INV-000015 style, prefix from organization.invoicePrefix).
   * Derived from the highest existing number under a per-org advisory lock held by `tx`, so it continues
   * existing sequences, never reuses a number after deletes and cannot hand the same number to two requests.
   */
  private async getNextInvoiceNumber(tx: Prisma.TransactionClient, organizationId: string): Promise<string> {
    const org = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { invoicePrefix: true },
    });

    const prefix = (org?.invoicePrefix || 'INV') + '-';
    return nextSequenceNumber(tx, organizationId, 'invoice', prefix, 6);
  }

  /** Every id an invoice references must belong to the caller's organization. */
  private async assertReferencesBelongToOrg(organizationId: string, input: CreateInvoiceInput) {
    const uniq = (ids: Array<string | undefined | null>) => [...new Set(ids.filter((x): x is string => !!x))];
    const productIds = uniq(input.items.map((i) => i.productId));
    const variantIds = uniq(input.items.map((i) => i.variantId));
    const warehouseIds = uniq(input.items.map((i) => i.warehouseId));
    const taxRateIds = uniq(input.items.map((i) => i.taxRateId));

    const [customer, salesOrder, coupon, products, variants, warehouses, taxRates] = await Promise.all([
      input.customerId ? prisma.customer.count({ where: { id: input.customerId, organizationId } }) : 1,
      input.salesOrderId ? prisma.salesOrder.count({ where: { id: input.salesOrderId, organizationId } }) : 1,
      input.couponId ? prisma.coupon.count({ where: { id: input.couponId, organizationId } }) : 1,
      productIds.length ? prisma.product.count({ where: { id: { in: productIds }, organizationId } }) : 0,
      variantIds.length ? prisma.productVariant.count({ where: { id: { in: variantIds }, product: { organizationId } } }) : 0,
      warehouseIds.length ? prisma.warehouse.count({ where: { id: { in: warehouseIds }, organizationId, isActive: true } }) : 0,
      taxRateIds.length ? prisma.taxRate.count({ where: { id: { in: taxRateIds }, organizationId } }) : 0,
    ]);

    if (!customer) throw new NotFoundError('Customer', input.customerId);
    if (!salesOrder) throw new NotFoundError('Sales order', input.salesOrderId);
    if (!coupon) throw new NotFoundError('Coupon', input.couponId);
    if (products !== productIds.length) throw new BadRequestError('One or more products were not found');
    if (variants !== variantIds.length) throw new BadRequestError('One or more product variants were not found');
    if (warehouses !== warehouseIds.length) throw new BadRequestError('One or more warehouses were not found or are inactive');
    if (taxRates !== taxRateIds.length) throw new BadRequestError('One or more tax rates were not found');
  }

  /**
   * Takes sold quantities out of stock for inventory-tracked products: a SALE stock entry in the line's
   * warehouse (validated to belong to the org, else the default warehouse) + product.openingStock, always
   * together. Untracked products/services touch neither. Short stock does not block the sale (policy).
   */
  private async deductStockForInvoice(tx: Prisma.TransactionClient, organizationId: string, invoiceId: string, items: any[], userId: string) {
    const productIds = [...new Set(items.map((i) => i.productId).filter(Boolean))] as string[];
    if (!productIds.length) return;
    const tracked = new Set(
      (await tx.product.findMany({ where: { id: { in: productIds }, organizationId, trackInventory: true }, select: { id: true } })).map((p) => p.id),
    );
    if (!tracked.size) return;
    await lockProducts(tx, [...tracked]);

    for (const item of items) {
      if (!item.productId || !tracked.has(item.productId)) continue;
      const warehouse = await resolveWarehouse(tx, organizationId, item.warehouseId);

      // Atomic decrement: read-modify-write would lose concurrent sales.
      await tx.product.update({
        where: { id: item.productId },
        data: { openingStock: { decrement: toDecimal(item.quantity) } },
      });

      await this.inventoryEngine.recordStockMovement(tx, {
        organizationId,
        warehouseId: warehouse.id,
        productId: item.productId,
        variantId: item.variantId || undefined,
        movementType: 'SALE',
        quantity: -toDecimal(item.quantity),
        rate: toDecimal(item.unitPrice),
        referenceType: 'INVOICE',
        referenceId: invoiceId,
        createdBy: userId,
      });
    }
  }

  private async getInvoiceOrThrow(invoiceId: string, organizationId: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: { items: true },
    });

    if (!invoice) throw new NotFoundError('Invoice', invoiceId);
    return invoice;
  }

  private async updateSalesOrderFulfillment(tx: any, salesOrderId: string, invoiceItems: any[]) {
    await this.adjustSalesOrderFulfillment(tx, salesOrderId, invoiceItems, 1);
  }

  private async releaseSalesOrderFulfillment(tx: any, salesOrderId: string, invoiceItems: any[]) {
    await this.adjustSalesOrderFulfillment(tx, salesOrderId, invoiceItems, -1);
  }

  /**
   * Adds (direction 1) or removes (-1) invoiced quantities on the order's lines, spreading a quantity over
   * several lines of the same product when needed, then recomputes the order status.
   */
  private async adjustSalesOrderFulfillment(tx: any, salesOrderId: string, invoiceItems: any[], direction: 1 | -1) {
    const salesOrder = await tx.salesOrder.findUnique({
      where: { id: salesOrderId },
      include: { items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
    });

    if (!salesOrder || salesOrder.status === 'CANCELLED') return;

    const fulfilled = new Map<string, number>(salesOrder.items.map((i: any) => [i.id, toDecimal(i.fulfilledQty)]));

    for (const invoiceItem of invoiceItems) {
      if (!invoiceItem.productId) continue;
      let qty = toDecimal(invoiceItem.quantity);
      const lines = salesOrder.items.filter((i: any) => i.productId === invoiceItem.productId);
      if (direction === -1) lines.reverse();
      for (const line of lines) {
        if (qty <= 0) break;
        const done = fulfilled.get(line.id)!;
        const room = direction === 1 ? toDecimal(line.quantity) - done : done;
        if (room <= 0) continue;
        const take = Math.min(room, qty);
        fulfilled.set(line.id, roundTo(done + direction * take, 3));
        qty = roundTo(qty - take, 3);
      }
      // Over-invoicing (more than ordered) is booked on the first line so it is not lost.
      if (qty > 0 && direction === 1 && lines.length) {
        fulfilled.set(lines[0].id, roundTo(fulfilled.get(lines[0].id)! + qty, 3));
      }
    }

    for (const line of salesOrder.items) {
      if (fulfilled.get(line.id) !== toDecimal(line.fulfilledQty)) {
        await tx.salesOrderItem.update({ where: { id: line.id }, data: { fulfilledQty: fulfilled.get(line.id) } });
      }
    }

    const all = salesOrder.items.every((i: any) => fulfilled.get(i.id)! >= toDecimal(i.quantity));
    const any = salesOrder.items.some((i: any) => fulfilled.get(i.id)! > 0);
    await tx.salesOrder.update({
      where: { id: salesOrderId },
      data: { status: all ? 'INVOICED' : any ? 'PARTIALLY_FULFILLED' : 'CONFIRMED' },
    });
  }
}

export const invoiceService = new InvoiceService();
