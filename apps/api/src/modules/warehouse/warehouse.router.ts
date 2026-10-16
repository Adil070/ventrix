import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { BadRequestError, NotFoundError } from '../../shared/errors';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

const WarehouseFields = {
  name: z.string().trim().min(1),
  code: z.string().trim().min(1).optional(),
  address: z.record(z.string()).optional(),
  branchId: z.string().min(1).optional(),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  // Accepted for backward compatibility; the Warehouse model has no email column, so it is not stored.
  email: z.string().email().optional(),
};

const CreateWarehouseSchema = z.object({ ...WarehouseFields, isDefault: z.boolean().default(false) });
const UpdateWarehouseSchema = z.object({ ...WarehouseFields, isDefault: z.boolean().optional(), isActive: z.boolean().optional() }).partial();

async function findOrgWarehouse(organizationId: string, id: string) {
  const warehouse = await prisma.warehouse.findFirst({ where: { id, organizationId } });
  if (!warehouse) throw new NotFoundError('Warehouse', id);
  return warehouse;
}

async function assertBranchInOrg(organizationId: string, branchId?: string) {
  if (!branchId) return;
  const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId }, select: { id: true } });
  if (!branch) throw new BadRequestError(`Branch '${branchId}' not found in this organization`);
}

function toData(input: z.infer<typeof UpdateWarehouseSchema>) {
  const { email: _email, address, ...rest } = input;
  return { ...rest, ...(address !== undefined && { address: address as Prisma.InputJsonValue }) };
}

router.get('/', async (req: Request, res: Response) => {
  const warehouses = await prisma.warehouse.findMany({ where: { organizationId: req.organizationId!, isActive: true }, orderBy: { name: 'asc' }, include: { branch: { select: { name: true } } } });
  res.json(successResponse({ warehouses }));
});

router.post('/', async (req: Request, res: Response) => {
  const organizationId = req.organizationId!;
  const input = CreateWarehouseSchema.parse(req.body);
  await assertBranchInOrg(organizationId, input.branchId);

  const warehouse = await prisma.$transaction(async (tx) => {
    // The first active warehouse of an org always becomes the default.
    const hasDefault = await tx.warehouse.count({ where: { organizationId, isActive: true, isDefault: true } });
    const isDefault = input.isDefault || hasDefault === 0;
    if (isDefault) {
      await tx.warehouse.updateMany({ where: { organizationId, isDefault: true }, data: { isDefault: false } });
    }
    return tx.warehouse.create({ data: { organizationId, ...toData(input), name: input.name, isDefault } });
  });
  res.status(201).json(successResponse(warehouse, 'Warehouse created'));
});

router.get('/:id', async (req: Request, res: Response) => {
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: req.params.id, organizationId: req.organizationId! },
    include: { _count: { select: { stockEntries: true } } },
  });
  if (!warehouse) throw new NotFoundError('Warehouse', req.params.id);
  res.json(successResponse(warehouse));
});

router.put('/:id', async (req: Request, res: Response) => {
  const organizationId = req.organizationId!;
  const current = await findOrgWarehouse(organizationId, req.params.id);
  const input = UpdateWarehouseSchema.parse(req.body);
  await assertBranchInOrg(organizationId, input.branchId);

  if (input.isDefault === true && input.isActive === false) {
    throw new BadRequestError('A warehouse cannot be both default and inactive');
  }
  if (input.isDefault === true && !current.isActive && input.isActive !== true) {
    throw new BadRequestError('Activate the warehouse before making it the default');
  }
  if (input.isDefault === false && current.isDefault) {
    throw new BadRequestError('This is the default warehouse. Set another warehouse as default instead.');
  }
  if (input.isActive === false && current.isActive) {
    if (current.isDefault) {
      throw new BadRequestError('Cannot deactivate the default warehouse. Set another warehouse as default first.');
    }
    const otherActive = await prisma.warehouse.count({ where: { organizationId, isActive: true, id: { not: current.id } } });
    if (otherActive === 0) throw new BadRequestError('Cannot deactivate the only active warehouse');
    const held = await prisma.stockEntry.groupBy({
      by: ['productId'],
      where: { warehouseId: current.id },
      _sum: { quantity: true },
    });
    if (held.some((h) => Number(h._sum.quantity ?? 0) !== 0)) {
      throw new BadRequestError('Warehouse still holds stock. Transfer it to another warehouse before deactivating.');
    }
  }

  const warehouse = await prisma.$transaction(async (tx) => {
    if (input.isDefault === true) {
      await tx.warehouse.updateMany({ where: { organizationId, isDefault: true, id: { not: current.id } }, data: { isDefault: false } });
    }
    return tx.warehouse.update({ where: { id: current.id }, data: toData(input) });
  });
  res.json(successResponse(warehouse));
});

// ─── Warehouse Stock ──────────────────────────────────────────────────────────
// Stock entries are signed (in > 0, out < 0), so the net per-warehouse stock is SUM(quantity).
router.get('/:id/stock', async (req: Request, res: Response) => {
  const organizationId = req.organizationId!;
  const warehouse = await findOrgWarehouse(organizationId, req.params.id);
  const where = { warehouseId: warehouse.id };

  const [net, ins, outs] = await Promise.all([
    prisma.stockEntry.groupBy({ by: ['productId'], where, _sum: { quantity: true } }),
    prisma.stockEntry.groupBy({ by: ['productId'], where: { ...where, quantity: { gt: 0 } }, _sum: { quantity: true } }),
    prisma.stockEntry.groupBy({ by: ['productId'], where: { ...where, quantity: { lt: 0 } }, _sum: { quantity: true } }),
  ]);
  const sumOf = (rows: typeof net, productId: string) => Number(rows.find((r) => r.productId === productId)?._sum.quantity ?? 0);

  const products = await prisma.product.findMany({
    where: { id: { in: net.map((m) => m.productId) }, organizationId },
    select: { id: true, name: true, sku: true, openingStock: true, sellingPrice: true, costPrice: true },
    orderBy: { name: 'asc' },
  });

  const stockData = products.map((p) => ({
    id: p.id,
    productId: p.id,
    name: p.name,
    sku: p.sku,
    openingStock: Number(p.openingStock), // org-wide running total for the product (all warehouses)
    sellingPrice: Number(p.sellingPrice),
    costPrice: Number(p.costPrice),
    stockIn: sumOf(ins, p.id),
    stockOut: -sumOf(outs, p.id), // reported as a positive number
    warehouseQuantity: sumOf(net, p.id), // net stock in this warehouse
  }));

  res.json(successResponse(stockData));
});

export { router as warehouseRouter };
