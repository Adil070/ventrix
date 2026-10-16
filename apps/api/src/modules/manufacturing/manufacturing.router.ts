import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse, paginatedResponse, roundTo } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { BadRequestError, NotFoundError } from '../../shared/errors';
import { getWarehouseProductStock, lockProducts, resolveWarehouse } from '../inventory/inventory.engine';
import { z } from 'zod';
import { Prisma, ProductionOrderStatus } from '@prisma/client';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

const CreateBOMSchema = z.object({
  productId: z.string().min(1),
  name: z.string().trim().min(1),
  quantity: z.number().positive().finite().default(1), // output quantity the materials below produce
  materials: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().positive().finite(),
    unitId: z.string().optional(),
    notes: z.string().optional(),
  })).min(1),
});

const CreateProductionOrderSchema = z.object({
  productId: z.string().min(1).optional(), // must match the BOM's product when given
  bomId: z.string().min(1),
  quantity: z.number().positive().finite(),
  scheduledDate: z.coerce.date(),
  notes: z.string().optional(),
  warehouseId: z.string().min(1).optional(),
});

const ListOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  status: z.nativeEnum(ProductionOrderStatus).optional(),
});

async function findOrgOrder(organizationId: string, id: string) {
  const order = await prisma.productionOrder.findFirst({
    where: { id, organizationId },
    include: { bom: { include: { components: true } } },
  });
  if (!order) throw new NotFoundError('Production order', id);
  return order;
}

// ─── Bill of Materials ────────────────────────────────────────────────────────
router.get('/bom', async (req: Request, res: Response) => {
  const boms = await prisma.billOfMaterial.findMany({
    where: { organizationId: req.organizationId!, isActive: true },
    include: { product: { select: { name: true, sku: true } }, components: { include: { product: { select: { name: true, sku: true } } } } },
  });
  res.json(successResponse(boms));
});

router.post('/bom', async (req: Request, res: Response) => {
  const organizationId = req.organizationId!;
  const input = CreateBOMSchema.parse(req.body);

  if (input.materials.some((m) => m.productId === input.productId)) {
    throw new BadRequestError('A BOM cannot use its own finished product as a material');
  }
  const ids = Array.from(new Set([input.productId, ...input.materials.map((m) => m.productId)]));
  const found = await prisma.product.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true } });
  const missing = ids.filter((id) => !found.some((p) => p.id === id));
  if (missing.length) throw new BadRequestError(`Product(s) not found in this organization: ${missing.join(', ')}`);

  const bom = await prisma.billOfMaterial.create({
    data: {
      organizationId, productId: input.productId, name: input.name, quantity: input.quantity,
      components: { create: input.materials.map((m, i) => ({ productId: m.productId, quantity: m.quantity, notes: m.notes, sortOrder: i })) },
    },
    include: { components: true },
  });
  res.status(201).json(successResponse(bom));
});

// ─── Production Orders ────────────────────────────────────────────────────────
router.get('/orders', async (req: Request, res: Response) => {
  const raw = Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '' && v !== undefined));
  const { page, limit, status } = ListOrdersQuerySchema.parse(raw);
  const where: Prisma.ProductionOrderWhereInput = {
    organizationId: req.organizationId!,
    ...(status && { status }),
  };
  const [data, total] = await Promise.all([
    prisma.productionOrder.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { bom: { select: { name: true, product: { select: { name: true } } } } } }),
    prisma.productionOrder.count({ where }),
  ]);
  res.json(paginatedResponse(data, { page, limit, total, totalPages: Math.ceil(total / limit) }));
});

router.post('/orders', async (req: Request, res: Response) => {
  const organizationId = req.organizationId!;
  const input = CreateProductionOrderSchema.parse(req.body);

  const bom = await prisma.billOfMaterial.findFirst({ where: { id: input.bomId, organizationId } });
  if (!bom) throw new BadRequestError(`BOM '${input.bomId}' not found in this organization`);
  if (!bom.isActive) throw new BadRequestError('BOM is inactive');
  if (input.productId && input.productId !== bom.productId) {
    throw new BadRequestError("productId does not match the BOM's finished product");
  }
  if (input.warehouseId) await resolveWarehouse(prisma, organizationId, input.warehouseId).catch(() => {
    throw new BadRequestError(`Warehouse '${input.warehouseId}' not found or inactive in this organization`);
  });

  const count = await prisma.productionOrder.count({ where: { organizationId } });
  const order = await prisma.productionOrder.create({
    data: {
      organizationId, bomId: bom.id,
      plannedQuantity: input.quantity,
      orderNumber: `PRO-${String(count + 1).padStart(5, '0')}`,
      status: 'DRAFT',
      plannedStartDate: input.scheduledDate,
      warehouseId: input.warehouseId,
      notes: input.notes,
      createdBy: req.userId,
    },
  });
  res.status(201).json(successResponse(order));
});

router.post('/orders/:id/start', async (req: Request, res: Response) => {
  const order = await findOrgOrder(req.organizationId!, req.params.id);
  if (order.status !== 'DRAFT') {
    throw new BadRequestError(`Only DRAFT production orders can be started (current status: ${order.status})`);
  }
  // Conditional update guards against a concurrent start.
  const { count } = await prisma.productionOrder.updateMany({
    where: { id: order.id, status: 'DRAFT' },
    data: { status: 'IN_PROGRESS', actualStartDate: new Date() },
  });
  if (count !== 1) throw new BadRequestError('Production order is no longer in DRAFT status');
  const updated = await prisma.productionOrder.findUniqueOrThrow({ where: { id: order.id } });
  res.json(successResponse(updated));
});

router.post('/orders/:id/complete', async (req: Request, res: Response) => {
  const organizationId = req.organizationId!;
  const order = await findOrgOrder(organizationId, req.params.id);
  if (order.status !== 'IN_PROGRESS') {
    throw new BadRequestError(`Only IN_PROGRESS production orders can be completed (current status: ${order.status})`);
  }
  if (!order.bom) throw new BadRequestError('Production order has no bill of materials');
  const bom = order.bom;
  const bomOutput = Number(bom.quantity);
  if (!(bomOutput > 0)) throw new BadRequestError('BOM output quantity must be greater than zero');

  const producedQty = Number(order.plannedQuantity);
  const factor = producedQty / bomOutput;

  // Material requirement per product, scaled by order qty / BOM output qty (+ scrap allowance).
  const required = new Map<string, number>();
  for (const c of bom.components) {
    const qty = Number(c.quantity) * factor * (1 + Number(c.scrapPercent ?? 0) / 100);
    required.set(c.productId, roundTo((required.get(c.productId) ?? 0) + qty, 3));
  }

  const warehouse = await resolveWarehouse(prisma, organizationId, order.warehouseId);

  const result = await prisma.$transaction(async (tx) => {
    await lockProducts(tx, [bom.productId, ...required.keys()]);

    const { count } = await tx.productionOrder.updateMany({
      where: { id: order.id, organizationId, status: 'IN_PROGRESS' },
      data: { status: 'COMPLETED', actualEndDate: new Date(), producedQuantity: producedQty },
    });
    if (count !== 1) throw new BadRequestError('Production order is no longer IN_PROGRESS');

    const products = await tx.product.findMany({
      where: { id: { in: [bom.productId, ...required.keys()] }, organizationId },
      select: { id: true, name: true, trackInventory: true, openingStock: true, costPrice: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    // Verify every tracked material is available in the production warehouse (and in total).
    const shortages: { productId: string; name: string; required: number; available: number }[] = [];
    for (const [productId, qty] of required) {
      const p = byId.get(productId);
      if (!p) throw new BadRequestError(`Material '${productId}' not found in this organization`);
      if (!p.trackInventory) continue;
      const available = Math.min(await getWarehouseProductStock(tx, organizationId, productId, warehouse.id), Number(p.openingStock));
      if (qty > available) shortages.push({ productId, name: p.name, required: qty, available });
    }
    if (shortages.length) {
      throw new BadRequestError(
        `Insufficient material stock in warehouse '${warehouse.name}': ` +
          shortages.map((s) => `${s.name} (required ${s.required}, available ${s.available})`).join('; '),
        shortages,
      );
    }

    let materialCost = 0;
    const consumed: { productId: string; quantity: number }[] = [];
    for (const [productId, qty] of required) {
      const p = byId.get(productId)!;
      await tx.materialIssue.create({ data: { productionOrderId: order.id, productId, quantity: qty, issuedBy: req.userId } });
      materialCost += qty * Number(p.costPrice);
      if (!p.trackInventory) continue; // untracked items (consumables/services) don't move stock
      const rate = Number(p.costPrice);
      await tx.product.update({ where: { id: productId }, data: { openingStock: { decrement: qty } } });
      await tx.stockEntry.create({
        data: {
          organizationId, warehouseId: warehouse.id, productId, movementType: 'PRODUCTION_OUT',
          quantity: -qty, rate, amount: roundTo(qty * rate),
          referenceType: 'PRODUCTION_ORDER', referenceId: order.id, notes: `Consumed for ${order.orderNumber}`, createdBy: req.userId,
        },
      });
      consumed.push({ productId, quantity: qty });
    }

    const finished = byId.get(bom.productId);
    if (!finished) throw new BadRequestError(`Finished product '${bom.productId}' not found in this organization`);
    if (finished.trackInventory) {
      const rate = roundTo(materialCost > 0 ? materialCost / producedQty : Number(finished.costPrice));
      await tx.product.update({ where: { id: finished.id }, data: { openingStock: { increment: producedQty } } });
      await tx.stockEntry.create({
        data: {
          organizationId, warehouseId: warehouse.id, productId: finished.id, movementType: 'PRODUCTION_IN',
          quantity: producedQty, rate, amount: roundTo(producedQty * rate),
          referenceType: 'PRODUCTION_ORDER', referenceId: order.id, notes: `Produced by ${order.orderNumber}`, createdBy: req.userId,
        },
      });
    }

    const updated = await tx.productionOrder.findUniqueOrThrow({ where: { id: order.id } });
    return { order: updated, warehouseId: warehouse.id, produced: { productId: finished.id, quantity: producedQty }, consumed };
  });

  res.json(successResponse(result, 'Production order completed'));
});

export { router as manufacturingRouter };
