import { prisma } from '../../infrastructure/database';
import { toDecimal, roundTo } from '../../shared/helpers/response.helper';
import { NotFoundError, BadRequestError } from '../../shared/errors';
import { Prisma } from '@prisma/client';

/**
 * Stock sign convention (single source of truth):
 *   every StockEntry.quantity is SIGNED — incoming movements are positive, outgoing movements are negative.
 * Per-warehouse stock is therefore SUM(quantity) over the warehouse's entries, and the sum across all
 * warehouses equals product.openingStock (the running total).
 */
export const OUT_MOVEMENT_TYPES = ['SALE', 'PURCHASE_RETURN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT', 'PRODUCTION_OUT', 'DAMAGE', 'EXPIRED'] as const;
export const IN_MOVEMENT_TYPES = ['PURCHASE', 'SALE_RETURN', 'ADJUSTMENT_IN', 'TRANSFER_IN', 'OPENING_STOCK', 'PRODUCTION_IN'] as const;

export function isOutMovement(movementType: string): boolean {
  return (OUT_MOVEMENT_TYPES as readonly string[]).includes(movementType);
}

/** Returns the quantity with the sign implied by the movement type (out → negative, in → positive). */
export function signedQuantity(movementType: string, quantity: number): number {
  const abs = Math.abs(Number(quantity));
  return isOutMovement(movementType) ? -abs : abs;
}

type Db = Prisma.TransactionClient | typeof prisma;

/** Net stock of a product in one warehouse, from its signed stock entries. */
export async function getWarehouseProductStock(db: Db, organizationId: string, productId: string, warehouseId: string): Promise<number> {
  const agg = await db.stockEntry.aggregate({
    // scope through the warehouse relation: some legacy entries have a NULL organizationId
    where: { productId, warehouseId, warehouse: { organizationId } },
    _sum: { quantity: true },
  });
  return toDecimal(agg._sum.quantity);
}

/** Row-locks products for the rest of the transaction so concurrent stock checks serialise. */
export async function lockProducts(tx: Prisma.TransactionClient, productIds: string[]): Promise<void> {
  const ids = Array.from(new Set(productIds)).sort();
  if (!ids.length) return;
  await tx.$queryRaw`SELECT id FROM products WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`;
}

/** Default warehouse for an org: active, isDefault first, then oldest. */
export async function getDefaultWarehouse(db: Db, organizationId: string) {
  return db.warehouse.findFirst({
    where: { organizationId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
}

/** Resolves an org-owned, active warehouse (explicit id or the default); throws 400/404 otherwise. */
export async function resolveWarehouse(db: Db, organizationId: string, warehouseId?: string | null) {
  if (warehouseId) {
    const wh = await db.warehouse.findFirst({ where: { id: warehouseId, organizationId } });
    if (!wh) throw new NotFoundError('Warehouse', warehouseId);
    if (!wh.isActive) throw new BadRequestError(`Warehouse '${wh.name}' is inactive`);
    return wh;
  }
  const wh = await getDefaultWarehouse(db, organizationId);
  if (!wh) throw new BadRequestError('No active warehouse configured. Create a warehouse first.');
  return wh;
}

interface StockMovement {
  organizationId: string;
  warehouseId: string;
  locationId?: string;
  productId: string;
  variantId?: string;
  batchLotId?: string;
  serialNumber?: string;
  movementType: string;
  quantity: number;
  rate: number;
  referenceType?: string;
  referenceId?: string;
  notes?: string;
  createdBy?: string;
}

/**
 * Inventory Engine
 * Manages stock movements with FIFO/LIFO/Weighted Average costing
 */
export class InventoryEngine {
  // ─── Record Stock Movement ────────────────────────────────────────────────────
  // Quantity is normalised to the sign convention above, so callers may pass either sign
  // (sales already pass negative, purchases positive).
  async recordStockMovement(tx: any, movement: StockMovement): Promise<void> {
    const quantity = signedQuantity(movement.movementType, movement.quantity);
    const amount = roundTo(Math.abs(quantity) * movement.rate);

    await tx.stockEntry.create({
      data: {
        organizationId: movement.organizationId,
        warehouseId: movement.warehouseId,
        locationId: movement.locationId,
        productId: movement.productId,
        variantId: movement.variantId,
        batchLotId: movement.batchLotId,
        serialNumber: movement.serialNumber,
        movementType: movement.movementType as any,
        quantity,
        rate: movement.rate,
        amount,
        referenceType: movement.referenceType,
        referenceId: movement.referenceId,
        notes: movement.notes,
        createdBy: movement.createdBy,
      },
    });
  }

  // ─── Get Stock Level ──────────────────────────────────────────────────────────
  async getStockLevel(
    organizationId: string,
    productId: string,
    warehouseId?: string
  ): Promise<{ quantity: number; value: number; averageCost: number }> {
    const where: any = { productId };
    if (warehouseId) where.warehouseId = warehouseId;

    const entries = await prisma.stockEntry.findMany({
      where: {
        ...where,
        warehouse: { organizationId },
      },
      select: { quantity: true, rate: true, amount: true, movementType: true },
    });

    let totalQty = 0;
    let totalValue = 0;

    for (const entry of entries) {
      const qty = toDecimal(entry.quantity);
      totalQty = roundTo(totalQty + qty);
      totalValue = roundTo(totalValue + toDecimal(entry.amount) * Math.sign(qty));
    }

    const averageCost = totalQty > 0 ? roundTo(totalValue / totalQty) : 0;

    return { quantity: totalQty, value: totalValue, averageCost };
  }

  // ─── Get Stock Summary ────────────────────────────────────────────────────────
  async getStockSummary(organizationId: string, warehouseId?: string) {
    const products = await prisma.product.findMany({
      where: { organizationId, trackInventory: true, isActive: true },
      select: {
        id: true,
        name: true,
        sku: true,
        minStockLevel: true,
        reorderPoint: true,
        unit: { select: { abbreviation: true } },
      },
    });

    const summaries = await Promise.all(
      products.map(async (product) => {
        const stock = await this.getStockLevel(organizationId, product.id, warehouseId);
        return {
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          unit: product.unit?.abbreviation,
          quantity: stock.quantity,
          value: stock.value,
          averageCost: stock.averageCost,
          minStockLevel: toDecimal(product.minStockLevel),
          reorderPoint: toDecimal(product.reorderPoint),
          isLowStock: stock.quantity <= toDecimal(product.reorderPoint),
        };
      })
    );

    return summaries;
  }

  // ─── FIFO Cost Calculation ────────────────────────────────────────────────────
  async calculateFIFOCost(productId: string, warehouseId: string, quantityNeeded: number): Promise<number> {
    const purchaseEntries = await prisma.stockEntry.findMany({
      where: {
        productId,
        warehouseId,
        movementType: { in: ['PURCHASE', 'ADJUSTMENT_IN', 'OPENING_STOCK'] },
      },
      orderBy: { createdAt: 'asc' },
    });

    let remainingQty = quantityNeeded;
    let totalCost = 0;

    for (const entry of purchaseEntries) {
      if (remainingQty <= 0) break;

      const entryQty = toDecimal(entry.quantity);
      const usedQty = Math.min(remainingQty, entryQty);
      totalCost += usedQty * toDecimal(entry.rate);
      remainingQty -= usedQty;
    }

    return roundTo(totalCost);
  }

  // ─── Stock Adjustment ─────────────────────────────────────────────────────────
  async adjustStock(
    organizationId: string,
    warehouseId: string,
    productId: string,
    adjustedQuantity: number,
    reason: string,
    userId: string
  ): Promise<void> {
    const currentStock = await this.getStockLevel(organizationId, productId, warehouseId);
    const difference = adjustedQuantity - currentStock.quantity;

    if (difference === 0) return;

    const movementType = difference > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';

    await prisma.stockEntry.create({
      data: {
        organizationId,
        warehouseId,
        productId,
        movementType: movementType as any,
        quantity: difference,
        rate: currentStock.averageCost,
        amount: roundTo(Math.abs(difference) * currentStock.averageCost),
        notes: reason,
        createdBy: userId,
      },
    });
  }

  // ─── Low Stock Alert ──────────────────────────────────────────────────────────
  async getLowStockProducts(organizationId: string) {
    const products = await prisma.product.findMany({
      where: { organizationId, trackInventory: true, isActive: true },
      select: {
        id: true,
        name: true,
        sku: true,
        reorderPoint: true,
        minStockLevel: true,
        unit: { select: { abbreviation: true } },
      },
    });

    const alerts = [];

    for (const product of products) {
      const stock = await this.getStockLevel(organizationId, product.id);
      if (stock.quantity <= toDecimal(product.reorderPoint)) {
        alerts.push({
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          unit: product.unit?.abbreviation,
          currentStock: stock.quantity,
          reorderPoint: toDecimal(product.reorderPoint),
          minStockLevel: toDecimal(product.minStockLevel),
          deficit: toDecimal(product.reorderPoint) - stock.quantity,
        });
      }
    }

    return alerts;
  }

  // ─── Inventory Valuation ──────────────────────────────────────────────────────
  async getInventoryValuation(organizationId: string, method: 'FIFO' | 'LIFO' | 'WEIGHTED_AVERAGE' = 'WEIGHTED_AVERAGE') {
    const stockSummary = await this.getStockSummary(organizationId);

    return {
      method,
      items: stockSummary,
      totalValue: roundTo(stockSummary.reduce((sum, item) => sum + item.value, 0)),
      totalProducts: stockSummary.filter(item => item.quantity > 0).length,
    };
  }

  // ─── Inventory Aging ──────────────────────────────────────────────────────────
  async getInventoryAging(organizationId: string) {
    const entries = await prisma.stockEntry.findMany({
      where: {
        warehouse: { organizationId },
        movementType: { in: ['PURCHASE', 'OPENING_STOCK'] },
      },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        warehouse: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const now = new Date();
    const aging = entries.reduce((acc: any, entry) => {
      const daysSince = Math.floor((now.getTime() - entry.createdAt.getTime()) / (1000 * 60 * 60 * 24));
      const bucket = daysSince < 30 ? '0-30' : daysSince < 60 ? '31-60' : daysSince < 90 ? '61-90' : '90+';

      if (!acc[entry.productId]) {
        acc[entry.productId] = {
          product: entry.product,
          warehouse: entry.warehouse,
          buckets: { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 },
          totalValue: 0,
        };
      }

      acc[entry.productId].buckets[bucket] += toDecimal(entry.amount);
      acc[entry.productId].totalValue += toDecimal(entry.amount);

      return acc;
    }, {});

    return Object.values(aging);
  }
}
