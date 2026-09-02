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

const CreateBOMSchema = z.object({
  productId: z.string(),
  name: z.string().min(1),
  quantity: z.number().positive().default(1),
  materials: z.array(z.object({
    productId: z.string(),
    quantity: z.number().positive(),
    unitId: z.string().optional(),
    notes: z.string().optional(),
  })).min(1),
});

const CreateProductionOrderSchema = z.object({
  productId: z.string(),
  bomId: z.string(),
  quantity: z.number().positive(),
  scheduledDate: z.coerce.date(),
  notes: z.string().optional(),
  warehouseId: z.string().optional(),
});

// ─── Bill of Materials ────────────────────────────────────────────────────────
router.get('/bom', async (req: Request, res: Response) => {
  const boms = await prisma.billOfMaterial.findMany({
    where: { organizationId: req.organizationId!, isActive: true },
    include: { product: { select: { name: true, sku: true } }, components: { include: { product: { select: { name: true, sku: true } } } } },
  });
  res.json(successResponse(boms));
});

router.post('/bom', async (req: Request, res: Response) => {
  const input = CreateBOMSchema.parse(req.body);
  const bom = await prisma.billOfMaterial.create({
    data: {
      organizationId: req.organizationId!, productId: input.productId, name: input.name, quantity: input.quantity,
      components: { create: input.materials.map(m => ({ productId: m.productId, quantity: m.quantity, notes: m.notes })) },
    },
    include: { components: true },
  });
  res.status(201).json(successResponse(bom));
});

// ─── Production Orders ────────────────────────────────────────────────────────
router.get('/orders', async (req: Request, res: Response) => {
  const { page = 1, limit = 20, status } = req.query as any;
  const where: Prisma.ProductionOrderWhereInput = {
    organizationId: req.organizationId!,
    ...(status && { status: status as any }),
  };
  const [data, total] = await Promise.all([
    prisma.productionOrder.findMany({ where, skip: (+page - 1) * +limit, take: +limit, orderBy: { createdAt: 'desc' }, include: { bom: { select: { name: true, product: { select: { name: true } } } } } }),
    prisma.productionOrder.count({ where }),
  ]);
  res.json(paginatedResponse(data, { page: +page, limit: +limit, total, totalPages: Math.ceil(total / +limit) }));
});

router.post('/orders', async (req: Request, res: Response) => {
  const input = CreateProductionOrderSchema.parse(req.body);
  const count = await prisma.productionOrder.count({ where: { organizationId: req.organizationId! } });
  const order = await prisma.productionOrder.create({
    data: {
      organizationId: req.organizationId!, bomId: input.bomId,
      plannedQuantity: input.quantity,
      orderNumber: `PRO-${String(count + 1).padStart(5, '0')}`,
      status: 'DRAFT',
      plannedStartDate: input.scheduledDate,
      warehouseId: input.warehouseId,
      notes: input.notes,
    },
  });
  res.status(201).json(successResponse(order));
});

router.post('/orders/:id/start', async (req: Request, res: Response) => {
  const order = await prisma.productionOrder.update({ where: { id: req.params.id }, data: { status: 'IN_PROGRESS', actualStartDate: new Date() } });
  res.json(successResponse(order));
});

router.post('/orders/:id/complete', async (req: Request, res: Response) => {
  const order = await prisma.productionOrder.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! }, include: { bom: { include: { components: true } } } });
  if (!order) return res.status(404).json({ error: 'Order not found' });

  await prisma.$transaction(async (tx) => {
    // Deduct raw materials
    if (order.bom) {
      for (const material of order.bom.components) {
        const qtyNeeded = Number(material.quantity) * Number(order.plannedQuantity);
        await tx.product.update({ where: { id: material.productId }, data: { openingStock: { decrement: qtyNeeded } } });
      }
      // Add finished goods
      await tx.product.update({ where: { id: order.bom.productId }, data: { openingStock: { increment: Number(order.plannedQuantity) } } });
    }
    await tx.productionOrder.update({ where: { id: order.id }, data: { status: 'COMPLETED', actualEndDate: new Date(), producedQuantity: order.plannedQuantity } });
  });

  res.json(successResponse({ message: 'Production order completed' }));
});

export { router as manufacturingRouter };
