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

const CreateExpenseSchema = z.object({
  categoryId: z.string().optional(),
  description: z.string().min(1),
  amount: z.number().positive(),
  date: z.coerce.date(),
  paymentMode: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'UPI', 'CHEQUE']).default('CASH'),
  bankAccountId: z.string().optional(),
  referenceNumber: z.string().optional(),
  isRecurring: z.boolean().default(false),
  recurringFrequency: z.string().optional(),
  taxable: z.boolean().default(false),
  gstRate: z.number().min(0).max(100).default(0),
  notes: z.string().optional(),
  attachmentUrls: z.array(z.string()).optional(),
  branchId: z.string().optional(),
});

router.get('/', async (req: Request, res: Response) => {
  const { page = 1, limit = 20, categoryId, fromDate, toDate, status } = req.query as any;
  const where: Prisma.ExpenseWhereInput = {
    organizationId: req.organizationId!,
    ...(categoryId && { categoryId }),
    ...(status && { status: status as any }),
    ...(fromDate && { expenseDate: { gte: new Date(fromDate) } }),
    ...(toDate && { expenseDate: { lte: new Date(toDate) } }),
  };
  const [data, total] = await Promise.all([
    prisma.expense.findMany({ where, skip: (+page - 1) * +limit, take: +limit, orderBy: { expenseDate: 'desc' }, include: { category: { select: { name: true } } } }),
    prisma.expense.count({ where }),
  ]);
  res.json(paginatedResponse(data, { page: +page, limit: +limit, total, totalPages: Math.ceil(total / +limit) }));
});

router.post('/', async (req: Request, res: Response) => {
  const input = CreateExpenseSchema.parse(req.body);
  const count = await prisma.expense.count({ where: { organizationId: req.organizationId! } });
  const expense = await prisma.expense.create({
    data: {
      organizationId: req.organizationId!,
      branchId: input.branchId,
      categoryId: input.categoryId,
      expenseNumber: `EXP-${String(count + 1).padStart(5, '0')}`,
      title: input.description,
      description: input.notes,
      amount: input.amount,
      taxAmount: 0,
      totalAmount: input.amount,
      expenseDate: input.date,
      paymentMode: input.paymentMode as any,
      bankAccountId: input.bankAccountId,
      status: 'APPROVED',
      receipts: (input as any).attachmentUrls ?? [],
      isRecurring: input.isRecurring,
      notes: input.notes,
    },
  });
  res.status(201).json(successResponse(expense, 'Expense created'));
});

router.get('/:id', async (req: Request, res: Response) => {
  const expense = await prisma.expense.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! }, include: { category: true } });
  res.json(successResponse(expense));
});

router.put('/:id', async (req: Request, res: Response) => {
  const input = CreateExpenseSchema.partial().parse(req.body);
  const expense = await prisma.expense.update({ where: { id: req.params.id }, data: { ...input, paymentMode: input.paymentMode as any } });
  res.json(successResponse(expense));
});

router.delete('/:id', async (req: Request, res: Response) => {
  await prisma.expense.delete({ where: { id: req.params.id } });
  res.json(successResponse({ message: 'Expense deleted' }));
});

// Expense categories
router.get('/categories/list', async (req: Request, res: Response) => {
  const categories = await prisma.expenseCategory.findMany({ orderBy: { name: 'asc' } });
  res.json(successResponse(categories));
});

router.post('/categories', async (req: Request, res: Response) => {
  const { name, description } = req.body;
  const category = await prisma.expenseCategory.create({ data: { name, description } });
  res.status(201).json(successResponse(category));
});

export { router as expenseRouter };
