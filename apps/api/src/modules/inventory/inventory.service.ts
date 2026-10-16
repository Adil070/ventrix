import { prisma } from '../../infrastructure/database';
import { NotFoundError, BadRequestError } from '../../shared/errors';
import { isOutMovement, signedQuantity, getWarehouseProductStock, lockProducts, resolveWarehouse } from './inventory.engine';
import { Prisma, StockMovementType } from '@prisma/client';

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
    if (!product) throw new NotFoundError('Product', input.productId);

    const movementType = input.type;
    const isOut = isOutMovement(movementType);
    // Explicit warehouse must belong to the org and be active; otherwise the org's default active warehouse.
    const warehouse = await resolveWarehouse(prisma, organizationId, input.warehouseId);
    const rate = input.unitCost ?? Number(product.costPrice);
    const quantity = signedQuantity(movementType, input.quantity);

    return prisma.$transaction(async (tx) => {
      await lockProducts(tx, [product.id]);
      const current = await tx.product.findUniqueOrThrow({ where: { id: product.id }, select: { openingStock: true } });
      const totalStock = Number(current.openingStock);

      if (isOut) {
        // Policy: manual stock-out never drives stock negative, neither in the warehouse nor in total.
        const warehouseStock = await getWarehouseProductStock(tx, organizationId, product.id, warehouse.id);
        if (input.quantity > warehouseStock) {
          throw new BadRequestError(`Insufficient stock in warehouse '${warehouse.name}'. Available: ${warehouseStock}, requested: ${input.quantity}`);
        }
        if (input.quantity > totalStock) {
          throw new BadRequestError(`Insufficient stock. Available: ${totalStock}, requested: ${input.quantity}`);
        }
      }

      const entry = await tx.stockEntry.create({
        data: {
          organizationId,
          productId: product.id,
          warehouseId: warehouse.id,
          movementType: movementType as any,
          quantity,
          rate,
          amount: Math.abs(quantity) * rate,
          referenceType: 'MANUAL_ADJUSTMENT',
          referenceId: input.referenceNumber,
          notes: input.notes,
          createdBy: userId,
        },
      });
      const updated = await tx.product.update({
        where: { id: product.id },
        data: { openingStock: { increment: quantity } },
        select: { openingStock: true },
      });
      const warehouseStock = await getWarehouseProductStock(tx, organizationId, product.id, warehouse.id);

      return {
        message: 'Stock adjusted successfully',
        newStock: Number(updated.openingStock),
        warehouseId: warehouse.id,
        warehouseStock,
        movementId: entry.id,
      };
    });
  }

  async transferStock(organizationId: string, userId: string, input: {
    productId: string; fromWarehouseId: string; toWarehouseId: string;
    quantity: number; notes?: string;
  }) {
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new BadRequestError('Source and destination warehouses must be different');
    }
    const product = await prisma.product.findFirst({ where: { id: input.productId, organizationId } });
    if (!product) throw new NotFoundError('Product', input.productId);

    const from = await resolveWarehouse(prisma, organizationId, input.fromWarehouseId);
    const to = await resolveWarehouse(prisma, organizationId, input.toWarehouseId);
    const rate = Number(product.costPrice);
    const amount = input.quantity * rate;

    // A transfer moves stock between warehouses; product.openingStock (the org-wide total) is unchanged.
    return prisma.$transaction(async (tx) => {
      await lockProducts(tx, [product.id]);
      const available = await getWarehouseProductStock(tx, organizationId, product.id, from.id);
      if (input.quantity > available) {
        throw new BadRequestError(`Insufficient stock in source warehouse '${from.name}'. Available: ${available}, requested: ${input.quantity}`);
      }
      await tx.stockEntry.create({
        data: { organizationId, productId: product.id, warehouseId: from.id, movementType: 'TRANSFER_OUT', quantity: -input.quantity, rate, amount, referenceType: 'WAREHOUSE_TRANSFER', referenceId: to.id, notes: input.notes, createdBy: userId },
      });
      await tx.stockEntry.create({
        data: { organizationId, productId: product.id, warehouseId: to.id, movementType: 'TRANSFER_IN', quantity: input.quantity, rate, amount, referenceType: 'WAREHOUSE_TRANSFER', referenceId: from.id, notes: input.notes, createdBy: userId },
      });
      return {
        message: 'Stock transferred successfully',
        fromWarehouseId: from.id,
        toWarehouseId: to.id,
        fromWarehouseStock: available - input.quantity,
        toWarehouseStock: await getWarehouseProductStock(tx, organizationId, product.id, to.id),
      };
    });
  }

  async getStockMovements(organizationId: string, query: { productId?: string; warehouseId?: string; type?: StockMovementType; page?: number; limit?: number; fromDate?: Date; toDate?: Date }) {
    const { productId, warehouseId, type, page = 1, limit = 20, fromDate, toDate } = query;
    const where: Prisma.StockEntryWhereInput = {
      organizationId,
      ...(productId && { productId }),
      ...(warehouseId && { warehouseId }),
      ...(type && { movementType: type }),
      ...((fromDate || toDate) && { createdAt: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } }),
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
