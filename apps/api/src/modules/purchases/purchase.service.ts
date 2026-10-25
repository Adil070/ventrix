import { prisma } from '../../infrastructure/database';
import { NotFoundError, BadRequestError } from '../../shared/errors';
import type { CreatePurchaseInput, PurchaseQueryInput } from './purchase.dto';
import { Prisma } from '@prisma/client';
import { roundTo, toDecimal } from '../../shared/helpers/response.helper';
import { AccountingEngine } from '../accounting/accounting.engine';
import { getWarehouseProductStock, lockProducts, resolveWarehouse } from '../inventory/inventory.engine';
import { nextPaymentNumber } from '../payments/payment.service';
import { nextSequenceNumber, retryOnUniqueViolation } from '../../shared/helpers/sequence';

const accountingEngine = new AccountingEngine();

export class PurchaseService {
  async createPurchase(organizationId: string, branchId: string | undefined, userId: string, input: CreatePurchaseInput) {
    // Everything referenced by id must belong to this organisation.
    const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, organizationId }, select: { id: true } });
    if (!supplier) throw new NotFoundError('Supplier');
    const productIds = [...new Set(input.items.map(i => i.productId))];
    const ownedProducts = await prisma.product.count({ where: { id: { in: productIds }, organizationId } });
    if (ownedProducts !== productIds.length) throw new NotFoundError('Product');
    const warehouseIds = [...new Set(input.items.map(i => i.warehouseId).filter((w): w is string => !!w))];
    for (const warehouseId of warehouseIds) await resolveWarehouse(prisma, organizationId, warehouseId); // org-owned & active, else 404/400

    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { purchasePrefix: true } });
    const prefix = org?.purchasePrefix || 'PUR';

    // Calculate totals (each component rounded to paise so the stored figures add up exactly)
    let subtotal = 0, taxAmount = 0, cgst = 0, sgst = 0;
    const igst = 0;
    const itemsData = input.items.map(item => {
      const itemSubtotal = item.quantity * item.unitPrice;
      const discAmt = roundTo(item.discountType === 'PERCENTAGE' ? itemSubtotal * item.discountValue / 100 : item.discountValue);
      const taxable = roundTo(itemSubtotal - discAmt);
      const halfTax = roundTo(taxable * item.taxRate / 200);
      const tax = roundTo(halfTax * 2);
      subtotal += taxable;
      taxAmount += tax;
      cgst += halfTax;
      sgst += halfTax;
      return { ...item, discountAmount: discAmt, taxableAmount: taxable, taxAmount: tax, cgstAmount: halfTax, sgstAmount: halfTax, igstAmount: 0, totalAmount: roundTo(taxable + tax) };
    });
    subtotal = roundTo(subtotal); taxAmount = roundTo(taxAmount); cgst = roundTo(cgst); sgst = roundTo(sgst);

    const discountAmount = roundTo(input.discountType === 'PERCENTAGE' ? subtotal * input.discountValue / 100 : input.discountValue);
    const totalAmount = roundTo(subtotal - discountAmount + taxAmount + input.shippingCharges + input.roundOff);
    const amountPaid = roundTo(input.amountPaid ?? 0);
    if (amountPaid - totalAmount > 0.005) {
      throw new BadRequestError(`Amount paid (${amountPaid}) cannot exceed the bill total (${totalAmount})`);
    }
    // CREDIT means "nothing paid now"; if money was paid without a mode, assume cash.
    const paymentMode = !input.paymentMode || input.paymentMode === 'CREDIT' ? 'CASH' : input.paymentMode;

    // The number is picked inside the transaction and retried if a concurrent purchase took it.
    const purchase = await retryOnUniqueViolation('purchaseNumber', () => prisma.$transaction(async (tx) => {
      const purchaseNumber = await nextSequenceNumber(tx, organizationId, 'purchase', `${prefix}-`, 5);
      const p = await tx.purchase.create({
        data: {
          organizationId, branchId, supplierId: input.supplierId,
          purchaseNumber, purchaseDate: input.purchaseDate, dueDate: input.dueDate, billNumber: input.billNumber,
          status: 'RECEIVED', subtotal, discountAmount,
          taxableAmount: roundTo(subtotal - discountAmount), cgstAmount: cgst, sgstAmount: sgst, igstAmount: igst,
          taxAmount, shippingCharges: input.shippingCharges, totalAmount,
          paidAmount: amountPaid, balanceAmount: roundTo(totalAmount - amountPaid),
          notes: input.notes, termsAndConditions: input.termsAndConditions, reverseCharge: input.reverseCharge,
          createdBy: userId,
          items: {
            create: itemsData.map(item => ({
              productId: item.productId, description: item.description ?? item.productId, quantity: item.quantity,
              unitPrice: item.unitPrice, discountAmount: item.discountAmount,
              taxRate: item.taxRate, taxableAmount: item.taxableAmount, taxAmount: item.taxAmount,
              cgstAmount: item.cgstAmount, sgstAmount: item.sgstAmount, igstAmount: item.igstAmount,
              amount: item.totalAmount, hsnCode: item.hsnCode, warehouseId: item.warehouseId,
              batchNumber: item.batchNumber,
            })),
          },
        },
        include: { items: true },
      });

      // Update inventory. A tracked item with no active warehouse to land in fails the whole purchase
      // (resolveWarehouse throws) instead of saving the bill without its stock.
      await lockProducts(tx, productIds);
      let defaultWarehouseId: string | undefined;
      for (const item of itemsData) {
        const product = await tx.product.findFirst({ where: { id: item.productId, organizationId }, select: { trackInventory: true } });
        if (product?.trackInventory) {
          if (!item.warehouseId && !defaultWarehouseId) defaultWarehouseId = (await resolveWarehouse(tx, organizationId)).id;
          await tx.product.update({ where: { id: item.productId }, data: { openingStock: { increment: item.quantity }, costPrice: item.unitPrice } });
          await tx.stockEntry.create({
            data: {
              organizationId,
              productId: item.productId,
              warehouseId: item.warehouseId ?? defaultWarehouseId!,
              movementType: 'PURCHASE',
              quantity: item.quantity,
              rate: item.unitPrice,
              amount: roundTo(item.quantity * item.unitPrice),
              referenceType: 'PURCHASE',
              referenceId: p.id,
              createdBy: userId,
            },
          });
        }
      }

      // Journal: Dr Purchases + input GST / Cr Accounts Payable for the full bill.
      await accountingEngine.postPurchaseEntry(tx, p, organizationId);

      // Money paid at purchase time is a real supplier payment: record it (cash-flow outflow, supplier
      // payment history) and post Dr Accounts Payable / Cr Cash-Bank for that amount only.
      if (amountPaid > 0) {
        const payment = await tx.payment.create({
          data: {
            organizationId, purchaseId: p.id, supplierId: input.supplierId,
            paymentNumber: await nextPaymentNumber(tx, organizationId),
            type: 'PAYMENT', mode: paymentMode as any, status: 'COMPLETED',
            amount: amountPaid, paymentDate: input.purchaseDate,
            notes: `Paid at purchase ${purchaseNumber}`, createdBy: userId,
          },
        });
        await accountingEngine.postPaymentEntry(tx, payment, p, organizationId);
      }

      return p;
    }));

    return purchase;
  }

  async listPurchases(organizationId: string, query: PurchaseQueryInput) {
    const { page, limit, search, supplierId, status, fromDate, toDate, sortBy, sortOrder } = query;
    const where: Prisma.PurchaseWhereInput = {
      organizationId,
      ...(search && { OR: [{ purchaseNumber: { contains: search, mode: 'insensitive' } }, { billNumber: { contains: search, mode: 'insensitive' } }] }),
      ...(supplierId && { supplierId }),
      ...(status && { status: status as any }),
      ...(fromDate && { purchaseDate: { gte: new Date(fromDate) } }),
      ...(toDate && { purchaseDate: { lte: new Date(toDate) } }),
    };
    const [data, total] = await Promise.all([
      prisma.purchase.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [sortBy]: sortOrder }, include: { supplier: { select: { id: true, name: true } } } }),
      prisma.purchase.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getPurchase(organizationId: string, id: string) {
    const purchase = await prisma.purchase.findFirst({
      where: { id, organizationId },
      include: { supplier: true, items: { include: { product: { select: { id: true, name: true, sku: true } } } }, payments: true },
    });
    if (!purchase) throw new NotFoundError('Purchase not found');
    return purchase;
  }

  /**
   * Cancel a purchase bill.
   * Policy: only an unpaid bill with no returns can be cancelled, and only while the goods it added are
   * still in stock. Anything else must go through a purchase return (debit note) so money and stock stay
   * traceable. Cancelling reverses the stock it added (PURCHASE_RETURN entries) and the journal entry.
   */
  async cancelPurchase(organizationId: string, id: string, userId: string, reason?: string) {
    return prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findFirst({ where: { id, organizationId }, include: { _count: { select: { returnOrders: true } } } });
      if (!purchase) throw new NotFoundError('Purchase');
      if (purchase.status === 'CANCELLED') throw new BadRequestError('Purchase already cancelled');
      if (toDecimal(purchase.paidAmount) > 0) {
        throw new BadRequestError(
          `Purchase ${purchase.purchaseNumber} has ${toDecimal(purchase.paidAmount)} paid against it and cannot be cancelled. Record a purchase return instead.`,
        );
      }
      if (purchase._count.returnOrders > 0) {
        throw new BadRequestError(`Purchase ${purchase.purchaseNumber} has returns recorded against it and cannot be cancelled.`);
      }

      // Claim the purchase first so a concurrent cancel/payment cannot slip in between.
      const claimed = await tx.purchase.updateMany({
        where: { id, organizationId, status: { not: 'CANCELLED' }, paidAmount: 0 },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason ?? null, balanceAmount: 0 },
      });
      if (claimed.count !== 1) throw new BadRequestError('Purchase was changed by another request; reload and try again');

      // Reverse exactly the stock this purchase added.
      const entries = await tx.stockEntry.findMany({
        where: { referenceType: 'PURCHASE', referenceId: id, movementType: 'PURCHASE', product: { organizationId } },
      });
      await lockProducts(tx, entries.map(e => e.productId));
      const byKey = new Map<string, { productId: string; warehouseId: string; quantity: number; rate: number }>();
      for (const e of entries) {
        const key = `${e.productId}|${e.warehouseId}`;
        const cur = byKey.get(key) ?? { productId: e.productId, warehouseId: e.warehouseId, quantity: 0, rate: toDecimal(e.rate) };
        cur.quantity += toDecimal(e.quantity);
        byKey.set(key, cur);
      }
      const perProduct = new Map<string, number>();
      for (const r of byKey.values()) perProduct.set(r.productId, (perProduct.get(r.productId) ?? 0) + r.quantity);

      const products = await tx.product.findMany({ where: { id: { in: [...perProduct.keys()] }, organizationId }, select: { id: true, name: true, openingStock: true } });
      for (const product of products) {
        if (toDecimal(product.openingStock) + 1e-9 < perProduct.get(product.id)!) {
          throw new BadRequestError(`Cannot cancel: stock of "${product.name}" from this purchase has already been sold or moved. Record a purchase return instead.`);
        }
      }
      for (const r of byKey.values()) {
        const inWarehouse = await getWarehouseProductStock(tx, organizationId, r.productId, r.warehouseId);
        if (inWarehouse + 1e-9 < r.quantity) {
          const name = products.find(p => p.id === r.productId)?.name ?? r.productId;
          throw new BadRequestError(`Cannot cancel: stock of "${name}" from this purchase has already been sold or moved. Record a purchase return instead.`);
        }
      }

      for (const r of byKey.values()) {
        await tx.stockEntry.create({
          data: {
            organizationId, productId: r.productId, warehouseId: r.warehouseId,
            movementType: 'PURCHASE_RETURN', quantity: -r.quantity, rate: r.rate, amount: roundTo(r.quantity * r.rate),
            referenceType: 'PURCHASE_CANCEL', referenceId: id, notes: `Cancelled ${purchase.purchaseNumber}`, createdBy: userId,
          },
        });
      }
      for (const product of products) {
        await tx.product.update({ where: { id: product.id }, data: { openingStock: { decrement: perProduct.get(product.id)! } } });
      }

      // Reverse the purchase journal entry (dated today, so earlier periods are not rewritten).
      await accountingEngine.reverseEntries(tx, organizationId, { purchaseId: id }, new Date(), `purchase ${purchase.purchaseNumber} cancelled`);

      return { message: 'Purchase cancelled' };
    });
  }
}

export const purchaseService = new PurchaseService();
