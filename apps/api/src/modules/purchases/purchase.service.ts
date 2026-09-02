import { prisma } from '../../infrastructure/database';
import { NotFoundError, BadRequestError } from '../../shared/errors';
import type { CreatePurchaseInput, PurchaseQueryInput } from './purchase.dto';
import { Prisma } from '@prisma/client';

export class PurchaseService {
  async createPurchase(organizationId: string, branchId: string | undefined, userId: string, input: CreatePurchaseInput) {
    // Generate purchase number
    const count = await prisma.purchase.count({ where: { organizationId } });
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { purchasePrefix: true } });
    const purchaseNumber = `${org?.purchasePrefix || 'PUR'}-${String(count + 1).padStart(5, '0')}`;

    // Calculate totals
    let subtotal = 0, taxAmount = 0, cgst = 0, sgst = 0, igst = 0;
    const itemsData = input.items.map(item => {
      const itemSubtotal = item.quantity * item.unitPrice;
      const discAmt = item.discountType === 'PERCENTAGE' ? itemSubtotal * item.discountValue / 100 : item.discountValue;
      const taxable = itemSubtotal - discAmt;
      const tax = taxable * item.taxRate / 100;
      const halfTax = tax / 2;
      subtotal += taxable;
      taxAmount += tax;
      cgst += halfTax;
      sgst += halfTax;
      return { ...item, discountAmount: discAmt, taxableAmount: taxable, taxAmount: tax, cgstAmount: halfTax, sgstAmount: halfTax, igstAmount: 0, totalAmount: taxable + tax };
    });

    const discountAmount = input.discountType === 'PERCENTAGE' ? subtotal * input.discountValue / 100 : input.discountValue;
    const totalAmount = subtotal - discountAmount + taxAmount + input.shippingCharges + input.roundOff;

    const purchase = await prisma.$transaction(async (tx) => {
      const p = await tx.purchase.create({
        data: {
          organizationId, branchId, supplierId: input.supplierId,
          purchaseNumber, purchaseDate: input.purchaseDate, dueDate: input.dueDate, billNumber: input.billNumber,
          status: 'RECEIVED', subtotal, discountAmount,
          taxableAmount: subtotal - discountAmount, cgstAmount: cgst, sgstAmount: sgst, igstAmount: igst,
          taxAmount, shippingCharges: input.shippingCharges, totalAmount,
          paidAmount: input.amountPaid, balanceAmount: totalAmount - input.amountPaid,
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

      // Update inventory
      // Get default warehouse for stock entries
      const defaultWarehouse = await tx.warehouse.findFirst({
        where: { organizationId, isActive: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }]
      });

      for (const item of itemsData) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (product?.trackInventory && defaultWarehouse) {
          const newStock = Number(product.openingStock) + item.quantity;
          await tx.product.update({ where: { id: item.productId }, data: { openingStock: newStock, costPrice: item.unitPrice } });
          await tx.stockEntry.create({
            data: { 
              organizationId, 
              productId: item.productId, 
              warehouseId: item.warehouseId ?? defaultWarehouse.id, 
              movementType: 'PURCHASE', 
              quantity: item.quantity, 
              rate: item.unitPrice, 
              amount: item.quantity * item.unitPrice, 
              referenceType: 'PURCHASE', 
              referenceId: p.id 
            },
          });
        }
      }

      // Update supplier outstanding
      const balDue = totalAmount - input.amountPaid;
      // Supplier outstanding is tracked via purchases directly

      return p;
    });

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

  async cancelPurchase(organizationId: string, id: string, userId: string) {
    const purchase = await prisma.purchase.findFirst({ where: { id, organizationId } });
    if (!purchase) throw new NotFoundError('Purchase not found');
    if (purchase.status === 'CANCELLED') throw new BadRequestError('Purchase already cancelled');
    await prisma.purchase.update({ where: { id }, data: { status: 'CANCELLED' } });
    return { message: 'Purchase cancelled' };
  }
}

export const purchaseService = new PurchaseService();
