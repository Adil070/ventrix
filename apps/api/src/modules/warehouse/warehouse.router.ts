import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse, paginatedResponse } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

const CreateWarehouseSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  address: z.record(z.string()).optional(),
  branchId: z.string().optional(),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  isDefault: z.boolean().default(false),
});

router.get('/', async (req: Request, res: Response) => {
  const warehouses = await prisma.warehouse.findMany({ where: { organizationId: req.organizationId!, isActive: true }, orderBy: { name: 'asc' }, include: { branch: { select: { name: true } } } });
  res.json(successResponse({ warehouses }));
});

router.post('/', async (req: Request, res: Response) => {
  const input = CreateWarehouseSchema.parse(req.body);
  const warehouse = await prisma.warehouse.create({ data: { organizationId: req.organizationId!, ...input, address: input.address as Prisma.InputJsonValue } });
  res.status(201).json(successResponse(warehouse, 'Warehouse created'));
});

router.get('/:id', async (req: Request, res: Response) => {
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: req.params.id, organizationId: req.organizationId! },
    include: { _count: { select: { stockEntries: true } } },
  });
  res.json(successResponse(warehouse));
});

router.put('/:id', async (req: Request, res: Response) => {
  const input = CreateWarehouseSchema.partial().parse(req.body);
  const warehouse = await prisma.warehouse.update({ where: { id: req.params.id }, data: { ...input, address: input.address as Prisma.InputJsonValue } });
  res.json(successResponse(warehouse));
});

// ─── Warehouse Stock ──────────────────────────────────────────────────────────
router.get('/:id/stock', async (req: Request, res: Response) => {
  const movements = await prisma.stockEntry.groupBy({
    by: ['productId'],
    where: { warehouseId: req.params.id, organizationId: req.organizationId! },
    _sum: { quantity: true },
  });

  const productIds = movements.map((m: any) => m.productId!).filter(Boolean);
  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, sku: true, openingStock: true, sellingPrice: true, costPrice: true } });

  const stockData = products.map(p => ({
    ...p,
    warehouseQuantity: movements.find((m: any) => m.productId === p.id)?._sum.quantity ?? 0,
  }));

  res.json(successResponse(stockData));
});

export { router as warehouseRouter };
