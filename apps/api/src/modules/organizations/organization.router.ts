import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

// ─── Organization Details ─────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const org = await prisma.organization.findUnique({
    where: { id: req.organizationId! },
    include: { branches: true, subscription: true, _count: { select: { customers: true, suppliers: true, products: true, invoices: true } } },
  });
  res.json(successResponse(org));
});

const UpdateOrgSchema = z.object({
  name: z.string().min(1).optional(),
  legalName: z.string().optional(),
  gstin: z.string().optional(),
  pan: z.string().optional(),
  cin: z.string().optional(),
  tan: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  website: z.string().url().optional(),
  industry: z.string().optional(),
  businessType: z.string().optional(),
  address: z.record(z.string()).optional(),
  billingAddress: z.record(z.string()).optional(),
  bankDetails: z.record(z.any()).optional(),
  invoicePrefix: z.string().max(10).optional(),
  purchasePrefix: z.string().max(10).optional(),
  quotationPrefix: z.string().max(10).optional(),
  currency: z.string().length(3).optional(),
  timezone: z.string().optional(),
  financialYearStart: z.number().min(1).max(12).optional(),
  settings: z.record(z.any()).optional(),
});

router.put('/', async (req: Request, res: Response) => {
  const input = UpdateOrgSchema.parse(req.body);
  const org = await prisma.organization.update({
    where: { id: req.organizationId! },
    data: { ...input, address: input.address as Prisma.InputJsonValue, billingAddress: input.billingAddress as Prisma.InputJsonValue, bankDetails: input.bankDetails as Prisma.InputJsonValue, settings: input.settings as Prisma.InputJsonValue },
  });
  res.json(successResponse(org, 'Organization updated'));
});

// ─── Branches ─────────────────────────────────────────────────────────────────
router.get('/branches', async (req: Request, res: Response) => {
  const branches = await prisma.branch.findMany({ where: { organizationId: req.organizationId! }, orderBy: { name: 'asc' } });
  res.json(successResponse(branches));
});

const CreateBranchSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  gstin: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.record(z.string()).optional(),
  isHeadOffice: z.boolean().default(false),
});

router.post('/branches', async (req: Request, res: Response) => {
  const input = CreateBranchSchema.parse(req.body);
  const branch = await prisma.branch.create({ data: { organizationId: req.organizationId!, ...input, address: input.address as Prisma.InputJsonValue } });
  res.status(201).json(successResponse(branch, 'Branch created'));
});

router.put('/branches/:id', async (req: Request, res: Response) => {
  const input = CreateBranchSchema.partial().parse(req.body);
  const branch = await prisma.branch.update({ where: { id: req.params.id }, data: { ...input, address: input.address as Prisma.InputJsonValue } });
  res.json(successResponse(branch));
});

// ─── Audit Logs ───────────────────────────────────────────────────────────────
router.get('/audit-logs', async (req: Request, res: Response) => {
  const { page = 1, limit = 20, action, userId, fromDate, toDate } = req.query as any;
  const where: Prisma.AuditLogWhereInput = {
    organizationId: req.organizationId!,
    ...(action && { action: { contains: action, mode: 'insensitive' } }),
    ...(userId && { userId }),
    ...(fromDate && { createdAt: { gte: new Date(fromDate) } }),
    ...(toDate && { createdAt: { lte: new Date(toDate) } }),
  };
  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({ where, skip: (+page - 1) * +limit, take: +limit, orderBy: { createdAt: 'desc' }, include: { user: { select: { firstName: true, lastName: true, email: true } } } }),
    prisma.auditLog.count({ where }),
  ]);
  res.json(successResponse({ data, meta: { page: +page, limit: +limit, total, totalPages: Math.ceil(total / +limit) } }));
});

// ─── Price Lists ──────────────────────────────────────────────────────────────
router.get('/price-lists', async (req: Request, res: Response) => {
  const lists = await prisma.priceList.findMany({ where: { organizationId: req.organizationId! } });
  res.json(successResponse(lists));
});

router.post('/price-lists', async (req: Request, res: Response) => {
  const { name, description, discountPercentage, isDefault } = req.body;
  const list = await prisma.priceList.create({ data: { organizationId: req.organizationId!, name, description, discountValue: discountPercentage ?? 0, isDefault } });
  res.status(201).json(successResponse(list));
});

// ─── Payment Terms ────────────────────────────────────────────────────────────
router.get('/payment-terms', async (req: Request, res: Response) => {
  const terms = await prisma.paymentTerm.findMany({ where: { organizationId: req.organizationId! }, orderBy: { days: 'asc' } });
  res.json(successResponse(terms));
});

export { router as organizationRouter };
