import { Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database';
import { cache, CacheService } from '../../infrastructure/cache';
import { NotFoundError, BadRequestError, ConflictError } from '../../shared/errors';
import { generateSequenceNumber, roundTo, toDecimal } from '../../shared/helpers/response.helper';
import type { CreateInvoiceInput, UpdateInvoiceInput, InvoiceQueryInput, RecordPaymentInput } from './invoice.dto';
import { AccountingEngine } from '../accounting/accounting.engine';
import { InventoryEngine } from '../inventory/inventory.engine';

export class InvoiceService {
  private readonly accountingEngine = new AccountingEngine();
  private readonly inventoryEngine = new InventoryEngine();

  // ─── Create Invoice ───────────────────────────────────────────────────────────
  async createInvoice(organizationId: string, branchId: string | undefined, userId: string, input: CreateInvoiceInput) {
    // Generate invoice number
    const invoiceNumber = await this.getNextInvoiceNumber(organizationId);

    // Calculate totals
    const calculated = this.calculateInvoiceTotals(input);

    // Determine initial status - auto-confirm if requested
    const autoConfirm = (input as any).autoConfirm ?? false;
    const initialStatus = autoConfirm ? 'CONFIRMED' : 'DRAFT';

    const invoice = await prisma.$transaction(async (tx) => {
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
        const defaultWarehouse = await tx.warehouse.findFirst({
          where: { organizationId, isActive: true },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }]
        });

        for (const item of created.items) {
          if (item.productId) {
            const warehouseId = item.warehouseId || defaultWarehouse?.id;
            
            if (warehouseId) {
              const product = await tx.product.findUnique({ 
                where: { id: item.productId },
                select: { trackInventory: true, openingStock: true }
              });

              if (product?.trackInventory) {
                const newStock = Number(product.openingStock) - toDecimal(item.quantity);
                await tx.product.update({ 
                  where: { id: item.productId }, 
                  data: { openingStock: newStock } 
                });
              }

              await this.inventoryEngine.recordStockMovement(tx, {
                organizationId,
                warehouseId,
                productId: item.productId,
                variantId: item.variantId || undefined,
                movementType: 'SALE',
                quantity: -toDecimal(item.quantity),
                rate: toDecimal(item.unitPrice),
                referenceType: 'INVOICE',
                referenceId: created.id,
                createdBy: userId,
              });
            }
          }
        }

        // Update sales order if linked
        if (created.salesOrderId) {
          await this.updateSalesOrderFulfillment(tx, created.salesOrderId, created.items);
        }
      }

      return created;
    });

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
      // Update status
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'CONFIRMED' },
      });

      // Post journal entries
      await this.accountingEngine.postSalesEntry(tx, invoice as any, organizationId);

      // Update inventory
      // Get default warehouse if items don't have warehouseId
      const defaultWarehouse = await tx.warehouse.findFirst({
        where: { organizationId, isActive: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }]
      });

      for (const item of invoice.items) {
        if (item.productId) {
          const warehouseId = item.warehouseId || defaultWarehouse?.id;
          
          if (warehouseId) {
            // Get product and update stock
            const product = await tx.product.findUnique({ 
              where: { id: item.productId },
              select: { trackInventory: true, openingStock: true }
            });

            if (product?.trackInventory) {
              // Decrease stock
              const newStock = Number(product.openingStock) - toDecimal(item.quantity);
              await tx.product.update({ 
                where: { id: item.productId }, 
                data: { openingStock: newStock } 
              });
            }

            // Record stock entry
            await this.inventoryEngine.recordStockMovement(tx, {
              organizationId,
              warehouseId,
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
      }

      // Update sales order if linked
      if (invoice.salesOrderId) {
        await this.updateSalesOrderFulfillment(tx, invoice.salesOrderId, invoice.items);
      }
    });

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

    const paymentAmount = Math.min(input.amount, toDecimal(invoice.balanceAmount));
    const newBalance = roundTo(toDecimal(invoice.balanceAmount) - paymentAmount);
    const newPaid = roundTo(toDecimal(invoice.paidAmount) + paymentAmount);
    const newStatus = newBalance <= 0 ? 'PAID' : 'PARTIALLY_PAID';

    const payment = await prisma.$transaction(async (tx) => {
      // Create payment
      const pay = await tx.payment.create({
        data: {
          invoiceId,
          customerId: invoice.customerId || undefined,
          paymentNumber: `PAY-${Date.now()}`,
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

      // Update invoice
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          paidAmount: newPaid,
          balanceAmount: newBalance,
          status: newStatus,
        },
      });

      // Post payment journal entry
      await this.accountingEngine.postReceiptEntry(tx, pay as any, invoice as any, organizationId);

      return pay;
    });

    await cache.del(CacheService.keys.dashboardStats(organizationId));

    return payment;
  }

  // ─── Cancel Invoice ───────────────────────────────────────────────────────────
  async cancelInvoice(organizationId: string, invoiceId: string, reason: string) {
    const invoice = await this.getInvoiceOrThrow(invoiceId, organizationId);

    if (invoice.status === 'CANCELLED') {
      throw new BadRequestError('Invoice is already cancelled');
    }

    if (invoice.status === 'PAID') {
      throw new BadRequestError('Cannot cancel a paid invoice. Create a credit note instead.');
    }

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: reason,
      },
    });

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

  private async getNextInvoiceNumber(organizationId: string): Promise<string> {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { invoicePrefix: true },
    });

    const prefix = org?.invoicePrefix || 'INV';
    const cacheKey = CacheService.keys.invoiceSeq(organizationId);

    // Atomic increment
    const seq = await cache['redis'].incr(cacheKey);
    if (seq === 1) {
      // Initialize from DB if first time
      const count = await prisma.invoice.count({ where: { organizationId } });
      await cache['redis'].set(cacheKey, count + 1);
      return generateSequenceNumber(prefix + '-', count + 1);
    }

    return generateSequenceNumber(prefix + '-', seq);
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
    const salesOrder = await tx.salesOrder.findUnique({
      where: { id: salesOrderId },
      include: { items: true },
    });

    if (!salesOrder) return;

    // Update fulfilled quantities
    for (const invoiceItem of invoiceItems) {
      if (invoiceItem.productId) {
        const soItem = salesOrder.items.find((i: any) => i.productId === invoiceItem.productId);
        if (soItem) {
          await tx.salesOrderItem.update({
            where: { id: soItem.id },
            data: { fulfilledQty: { increment: toDecimal(invoiceItem.quantity) } },
          });
        }
      }
    }

    // Check if fully fulfilled
    const updatedItems = await tx.salesOrderItem.findMany({ where: { salesOrderId } });
    const allFulfilled = updatedItems.every((i: any) => toDecimal(i.fulfilledQty) >= toDecimal(i.quantity));

    await tx.salesOrder.update({
      where: { id: salesOrderId },
      data: { status: allFulfilled ? 'INVOICED' : 'PARTIALLY_FULFILLED' },
    });
  }
}

export const invoiceService = new InvoiceService();
