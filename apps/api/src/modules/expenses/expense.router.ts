import { Router } from 'express';
import { nextSequenceNumber, retryOnUniqueViolation } from '../../shared/helpers/sequence';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse, paginatedResponse } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { NotFoundError } from '../../shared/errors';
import { AccountingEngine } from '../accounting/accounting.engine';

const accountingEngine = new AccountingEngine();

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

/** Validate ids referenced by an expense; returns the category name (used to pick the expense ledger account). */
async function checkExpenseRefs(organizationId: string, input: { categoryId?: string; bankAccountId?: string; branchId?: string }) {
  let categoryName: string | null = null;
  if (input.categoryId) {
    const category = await prisma.expenseCategory.findFirst({ where: { id: input.categoryId, organizationId }, select: { name: true } });
    if (!category) throw new NotFoundError('Expense category');
    categoryName = category.name;
  }
  if (input.bankAccountId && !(await prisma.bankAccount.findFirst({ where: { id: input.bankAccountId, organizationId }, select: { id: true } }))) {
    throw new NotFoundError('Bank account');
  }
  if (input.branchId && !(await prisma.branch.findFirst({ where: { id: input.branchId, organizationId }, select: { id: true } }))) {
    throw new NotFoundError('Branch');
  }
  return categoryName;
}

// Expenses are recorded as paid: Dr expense account (by category) / Cr Cash or Bank (by payment mode), in the same transaction.
router.post('/', async (req: Request, res: Response) => {
  const input = CreateExpenseSchema.parse(req.body);
  const organizationId = req.organizationId!;
  const categoryName = await checkExpenseRefs(organizationId, input);
  // Number taken from the locked per-org sequence inside the transaction.
  const expense = await retryOnUniqueViolation('expenseNumber', () => prisma.$transaction(async (tx) => {
    const expenseNumber = await nextSequenceNumber(tx, organizationId, 'expense', 'EXP-', 5);
    const created = await tx.expense.create({
      data: {
        organizationId,
        branchId: input.branchId,
        categoryId: input.categoryId,
        expenseNumber,
        title: input.description,
        description: input.notes,
        amount: input.amount,
        taxAmount: 0,
        totalAmount: input.amount,
        expenseDate: input.date,
        paymentMode: input.paymentMode as any,
        bankAccountId: input.bankAccountId,
        status: 'APPROVED',
        receipts: input.attachmentUrls ?? [],
        isRecurring: input.isRecurring,
        notes: input.notes,
        createdBy: req.userId,
      },
    });
    await accountingEngine.postExpenseEntry(tx, created, categoryName, organizationId);
    return created;
  }));
  res.status(201).json(successResponse(expense, 'Expense created'));
});

router.get('/:id', async (req: Request, res: Response) => {
  const expense = await prisma.expense.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! }, include: { category: true } });
  if (!expense) throw new NotFoundError('Expense');
  res.json(successResponse(expense));
});

router.put('/:id', async (req: Request, res: Response) => {
  const input = CreateExpenseSchema.partial().parse(req.body);
  const organizationId = req.organizationId!;
  const existing = await prisma.expense.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) throw new NotFoundError('Expense');
  await checkExpenseRefs(organizationId, input);

  // Map the API's field names onto the Expense model (only fields that were sent).
  const data: Prisma.ExpenseUncheckedUpdateInput = {
    ...(input.description !== undefined && { title: input.description }),
    ...(input.notes !== undefined && { description: input.notes, notes: input.notes }),
    ...(input.amount !== undefined && { amount: input.amount, totalAmount: input.amount }),
    ...(input.date !== undefined && { expenseDate: input.date }),
    ...(input.paymentMode !== undefined && { paymentMode: input.paymentMode as any }),
    ...(input.bankAccountId !== undefined && { bankAccountId: input.bankAccountId }),
    ...(input.categoryId !== undefined && { categoryId: input.categoryId }),
    ...(input.branchId !== undefined && { branchId: input.branchId }),
    ...(input.isRecurring !== undefined && { isRecurring: input.isRecurring }),
    ...(input.attachmentUrls !== undefined && { receipts: input.attachmentUrls }),
  };
  const financial = ['amount', 'date', 'paymentMode', 'bankAccountId', 'categoryId'].some(k => (input as any)[k] !== undefined);

  const expense = await prisma.$transaction(async (tx) => {
    const updated = await tx.expense.update({ where: { id: existing.id }, data, include: { category: { select: { name: true } } } });
    if (financial) {
      // Re-book: reverse the old entry (dated today) and post the corrected one.
      await accountingEngine.reverseEntries(tx, organizationId, { referenceType: 'EXPENSE', referenceId: existing.id }, new Date(), `expense ${existing.expenseNumber} edited`);
      await accountingEngine.postExpenseEntry(tx, updated, updated.category?.name, organizationId);
    }
    return updated;
  });
  res.json(successResponse(expense));
});

router.delete('/:id', async (req: Request, res: Response) => {
  const organizationId = req.organizationId!;
  const existing = await prisma.expense.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) throw new NotFoundError('Expense');
  await prisma.$transaction(async (tx) => {
    await accountingEngine.reverseEntries(tx, organizationId, { referenceType: 'EXPENSE', referenceId: existing.id }, new Date(), `expense ${existing.expenseNumber} deleted`);
    await tx.expense.delete({ where: { id: existing.id } });
  });
  res.json(successResponse({ message: 'Expense deleted' }));
});

// Expense categories
router.get('/categories/list', async (req: Request, res: Response) => {
  const categories = await prisma.expenseCategory.findMany({ where: { organizationId: req.organizationId! }, orderBy: { name: 'asc' } });
  res.json(successResponse(categories));
});

router.post('/categories', async (req: Request, res: Response) => {
  const { name, description } = z.object({ name: z.string().trim().min(1), description: z.string().optional() }).parse(req.body);
  const category = await prisma.expenseCategory.create({ data: { organizationId: req.organizationId!, name, description } });
  res.status(201).json(successResponse(category));
});

export { router as expenseRouter };
