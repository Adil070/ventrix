import { prisma } from '../../infrastructure/database';
import { NotFoundError, ConflictError, BadRequestError } from '../../shared/errors';
import type { CreateProductInput, UpdateProductInput, ProductQueryInput } from './product.dto';
import { Prisma } from '@prisma/client';
import { InventoryEngine, getDefaultWarehouse, resolveWarehouse } from '../inventory/inventory.engine';

const inventoryEngine = new InventoryEngine();

export class ProductService {
  async createProduct(organizationId: string, input: CreateProductInput) {
    if (input.sku) {
      const existing = await prisma.product.findFirst({ where: { organizationId, sku: input.sku } });
      if (existing) throw new ConflictError('SKU already exists');
    }
    if (input.warehouseId) await resolveWarehouse(prisma, organizationId, input.warehouseId);
    const product = await prisma.product.create({
      data: {
        organizationId,
        name: input.name,
        sku: input.sku || null,
        barcode: input.barcode,
        hsnCode: input.hsnCode,
        sacCode: input.sacCode,
        description: input.description,
        categoryId: input.categoryId,
        brandId: input.brandId,
        unitId: input.unitId,
        type: input.type as any,
        taxRate: input.taxRate,
        taxRateId: input.taxRateId,
        sellingPrice: input.sellingPrice,
        costPrice: input.purchasePrice,
        mrp: input.mrp,
        openingStock: input.openingStock,
        reorderPoint: input.reorderLevel,
        maxStockLevel: input.maxStockLevel,
        valuationMethod: input.valuationMethod as any,
        trackInventory: input.trackInventory,
        hasBatchTracking: input.hasBatches,
        hasSerialTracking: input.hasSerialNumbers,
        hasVariants: input.hasVariants,
        images: input.imageUrls ?? [],
        attributes: input.attributes as Prisma.InputJsonValue,
      },
    });

    // Create opening stock movement if applicable
    if (input.trackInventory && input.openingStock > 0) {
      // Get default warehouse or skip stock entry if no warehouse exists
      const defaultWarehouse = await prisma.warehouse.findFirst({
        where: { organizationId, isActive: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }]
      });

      if (defaultWarehouse) {
        await prisma.stockEntry.create({
          data: {
            organizationId,
            productId: product.id,
            warehouseId: input.warehouseId ?? defaultWarehouse.id,
            movementType: 'OPENING_STOCK',
            quantity: input.openingStock,
            rate: input.purchasePrice ?? 0,
            amount: input.openingStock * (input.purchasePrice ?? 0),
            referenceType: 'OPENING_STOCK',
            notes: 'Opening stock entry',
          },
        });
      }
    }

    return product;
  }

  async listProducts(organizationId: string, query: ProductQueryInput) {
    const { page, limit, search, categoryId, brandId, type, lowStock, sortBy, sortOrder } = query;
    const where: Prisma.ProductWhereInput = {
      organizationId, isActive: true,
      ...(search && { OR: [{ name: { contains: search, mode: 'insensitive' } }, { sku: { contains: search, mode: 'insensitive' } }, { barcode: { contains: search } }, { hsnCode: { contains: search } }] }),
      ...(categoryId && { categoryId }),
      ...(brandId && { brandId }),
      ...(type && { type: type as any }),
      ...(lowStock && { reorderPoint: { gt: 0 }, openingStock: { lte: prisma.product.fields.reorderPoint } }),
    };
    const [data, total] = await Promise.all([
      prisma.product.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [sortBy]: sortOrder }, include: { category: { select: { id: true, name: true } }, brand: { select: { id: true, name: true } }, unit: { select: { id: true, name: true, abbreviation: true } } } }),
      prisma.product.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getProduct(organizationId: string, id: string) {
    const product = await prisma.product.findFirst({
      where: { id, organizationId },
      include: { category: true, brand: true, unit: true, taxRateRef: true, variants: true, batchLots: { where: { quantity: { gt: 0 } }, orderBy: { expiryDate: 'asc' } } },
    });
    if (!product) throw new NotFoundError('Product not found');
    return product;
  }

  async updateProduct(organizationId: string, id: string, input: UpdateProductInput) {
    const product = await prisma.product.findFirst({ where: { id, organizationId } });
    if (!product) throw new NotFoundError('Product not found');
    if (input.sku && input.sku !== product.sku) {
      const clash = await prisma.product.findFirst({ where: { organizationId, sku: input.sku, id: { not: id } }, select: { id: true } });
      if (clash) throw new ConflictError('SKU already exists');
    }
    // A stock change made through the product form is booked as an adjustment so the stock ledger
    // (signed stock entries) keeps matching product.openingStock.
    const stockDelta = input.openingStock !== undefined ? Number(input.openingStock) - Number(product.openingStock) : 0;
    const trackInventory = input.trackInventory ?? product.trackInventory;
    return prisma.$transaction(async (tx) => {
      if (stockDelta && trackInventory) {
        const warehouse = await getDefaultWarehouse(tx, organizationId);
        if (warehouse) {
          await inventoryEngine.recordStockMovement(tx, {
            organizationId, productId: id, warehouseId: warehouse.id,
            movementType: stockDelta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
            quantity: stockDelta, rate: Number(input.purchasePrice ?? product.costPrice ?? 0),
            referenceType: 'PRODUCT_EDIT', referenceId: id, notes: 'Stock changed from product form',
          });
        }
      }
      return tx.product.update({
      where: { id },
      data: {
        name: input.name,
        ...(input.sku !== undefined && { sku: input.sku || null }),
        description: input.description,
        hsnCode: input.hsnCode,
        type: input.type as any,
        taxRate: input.taxRate,
        sellingPrice: input.sellingPrice,
        costPrice: input.purchasePrice,
        mrp: input.mrp,
        openingStock: input.openingStock,
        trackInventory: input.trackInventory,
        reorderPoint: input.reorderLevel,
        attributes: input.attributes as Prisma.InputJsonValue,
      },
    });
    });
  }

  async deleteProduct(organizationId: string, id: string) {
    const product = await prisma.product.findFirst({ where: { id, organizationId } });
    if (!product) throw new NotFoundError('Product not found');
    await prisma.product.update({ where: { id }, data: { isActive: false } });
    return { message: 'Product deactivated successfully' };
  }

  async getStockHistory(organizationId: string, productId: string, page = 1, limit = 20) {
    const where = { organizationId, productId };
    const [data, total] = await Promise.all([
      prisma.stockEntry.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { warehouse: { select: { id: true, name: true } } } }),
      prisma.stockEntry.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getLowStockProducts(organizationId: string) {
    return prisma.$queryRaw`
      SELECT p.*, pc.name as category_name
      FROM products p
      LEFT JOIN product_categories pc ON p."categoryId" = pc.id
      WHERE p."organizationId" = ${organizationId}
        AND p."isActive" = true
        AND p."trackInventory" = true
        AND p."reorderPoint" > 0
        AND p."openingStock" <= p."reorderPoint"
      ORDER BY (p."openingStock" - p."reorderPoint") ASC
    `;
  }

  // Categories
  async listCategories(organizationId: string) {
    return prisma.productCategory.findMany({ where: { organizationId }, orderBy: { name: 'asc' }, include: { parent: { select: { id: true, name: true } } } });
  }
  async createCategory(organizationId: string, data: { name: string; parentId?: string; description?: string }) {
    return prisma.productCategory.create({ data: { organizationId, ...data } });
  }

  // Units
  async listUnits(organizationId: string) {
    return prisma.unit.findMany({ where: { organizationId }, orderBy: { name: 'asc' } });
  }
  async createUnit(organizationId: string, data: { name: string; abbreviation: string }) {
    return prisma.unit.create({ data: { organizationId, ...data } });
  }

  // Brands
  async listBrands(organizationId: string) {
    return prisma.brand.findMany({ where: { organizationId }, orderBy: { name: 'asc' } });
  }
  async createBrand(organizationId: string, data: { name: string; description?: string }) {
    return prisma.brand.create({ data: { organizationId, ...data } });
  }
}

export const productService = new ProductService();
