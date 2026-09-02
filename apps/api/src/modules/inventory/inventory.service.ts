import { prisma } from '../../infrastructure/database';
import { NotFoundError, BadRequestError } from '../../shared/errors';
import { InventoryEngine } from './inventory.engine';
import { Prisma } from '@prisma/client';

const inventoryEngine = new InventoryEngine();

export class InventoryService {
  async getStockSummary(organizationId: string, warehouseId?: string) {
    const where: any = { organizationId, isActive: true, trackInventory: true };
    const products = await prisma.product.findMany({
      where,
      include: { category: { select: { name: true } }, unit: { select: { name: true, abbreviation: true } }, brand: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    return products.map(p => ({
      ...p,
      currentStock: Number(p.openingStock),
      reorderLevel: Number(p.reorderPoint),
      purchasePrice: Number(p.costPrice),
      stockValue: Number(p.openingStock) * Number(p.costPrice),
      isLowStock: p.reorderPoint != null && Number(p.openingStock) <= Number(p.reorderPoint),
    }));
  }

  async adjustStock(organizationId: string, userId: string, input: {
    productId: string; warehouseId?: string; type: string; quantity: number;
    unitCost?: number; notes?: string; referenceNumber?: string;
  }) {
    const product = await prisma.product.findFirst({ where: { id: input.productId, organizationId } });
    if (!product) throw new NotFoundError('Product not found');

    const movementType = input.type as any;
    const isIn = ['ADJUSTMENT_IN', 'OPENING_STOCK', 'TRANSFER_IN', 'PURCHASE', 'RETURN_IN'].includes(movementType);
    const isOut = ['ADJUSTMENT_OUT', 'SALE', 'TRANSFER_OUT', 'DAMAGE', 'EXPIRED', 'RETURN_OUT'].includes(movementType);

    if (isOut && Number(product.openingStock) < input.quantity) {
      throw new BadRequestError(`Insufficient stock. Available: ${product.openingStock}`);
    }

    const balanceQty = isIn
      ? Number(product.openingStock) + input.quantity
      : Number(product.openingStock) - input.quantity;

    // Find a valid warehouse — required by StockEntry FK constraint
    const warehouse = input.warehouseId
      ? await prisma.warehouse.findFirst({ where: { id: input.warehouseId, organizationId } })
      : await prisma.warehouse.findFirst({ where: { organizationId } });

    if (warehouse) {
      // Create audit entry + update stock atomically
      await prisma.$transaction(async (tx) => {
        await tx.stockEntry.create({
          data: {
            organizationId,
            productId: input.productId,
            warehouseId: warehouse.id,
            movementType: movementType,
            quantity: input.quantity,
            rate: input.unitCost ?? Number(product.costPrice),
            amount: input.quantity * (input.unitCost ?? Number(product.costPrice)),
            referenceType: 'MANUAL_ADJUSTMENT',
            referenceId: input.referenceNumber,
            notes: input.notes,
            createdBy: userId,
          },
        });
        await tx.product.update({ where: { id: input.productId }, data: { openingStock: balanceQty } });
      });
    } else {
      // No warehouse configured yet — still update the stock count directly
      await prisma.product.update({ where: { id: input.productId }, data: { openingStock: balanceQty } });
    }

    return { message: 'Stock adjusted successfully', newStock: balanceQty };
  }

  async transferStock(organizationId: string, userId: string, input: {
    productId: string; fromWarehouseId: string; toWarehouseId: string;
    quantity: number; notes?: string;
  }) {
    const product = await prisma.product.findFirst({ where: { id: input.productId, organizationId } });
    if (!product) throw new NotFoundError('Product not found');
    if (Number(product.openingStock) < input.quantity) throw new BadRequestError('Insufficient stock');

    await prisma.$transaction(async (tx) => {
      await tx.stockEntry.create({
        data: { organizationId, productId: input.productId, warehouseId: input.fromWarehouseId, movementType: 'TRANSFER_OUT', quantity: input.quantity, rate: Number(product.costPrice), amount: input.quantity * Number(product.costPrice), referenceType: 'WAREHOUSE_TRANSFER', notes: input.notes, createdBy: userId },
      });
      await tx.stockEntry.create({
        data: { organizationId, productId: input.productId, warehouseId: input.toWarehouseId, movementType: 'TRANSFER_IN', quantity: input.quantity, rate: Number(product.costPrice), amount: input.quantity * Number(product.costPrice), referenceType: 'WAREHOUSE_TRANSFER', notes: input.notes, createdBy: userId },
      });
    });
    return { message: 'Stock transferred successfully' };
  }

  async getStockMovements(organizationId: string, query: { productId?: string; warehouseId?: string; type?: string; page?: number; limit?: number; fromDate?: string; toDate?: string }) {
    const { productId, warehouseId, type, page = 1, limit = 20, fromDate, toDate } = query;
    const where: Prisma.StockEntryWhereInput = {
      organizationId,
      ...(productId && { productId }),
      ...(warehouseId && { warehouseId }),
      ...(type && { movementType: type as any }),
      ...(fromDate && { createdAt: { gte: new Date(fromDate) } }),
      ...(toDate && { createdAt: { lte: new Date(toDate) } }),
    };
    const [data, total] = await Promise.all([
      prisma.stockEntry.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { product: { select: { name: true, sku: true } }, warehouse: { select: { name: true } } } }),
      prisma.stockEntry.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getInventoryValuation(organizationId: string) {
    const products = await prisma.product.findMany({
      where: { organizationId, isActive: true, trackInventory: true },
      include: { category: { select: { name: true } } },
    });
    const total = products.reduce((s, p) => s + Number(p.openingStock) * Number(p.costPrice), 0);
    return { products: products.map(p => ({ ...p, value: Number(p.openingStock) * Number(p.costPrice) })), totalValue: total };
  }
}

export const inventoryService = new InventoryService();
