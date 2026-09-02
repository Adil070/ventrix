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

// ─── Bank Accounts ────────────────────────────────────────────────────────────
router.get('/accounts', async (req: Request, res: Response) => {
  const accounts = await prisma.bankAccount.findMany({ where: { organizationId: req.organizationId! }, orderBy: { createdAt: 'desc' } });
  res.json(successResponse(accounts));
});

const BankAccountSchema = z.object({
  accountName: z.string().min(1),
  bankName: z.string().min(1),
  accountNumber: z.string().min(1),
  ifscCode: z.string().optional(),
  branchName: z.string().optional(),
  accountType: z.enum(['SAVINGS', 'CURRENT', 'CASH', 'CREDIT_CARD']).default('CURRENT'),
  openingBalance: z.number().default(0),
  isDefault: z.boolean().default(false),
});

router.post('/accounts', async (req: Request, res: Response) => {
  const input = BankAccountSchema.parse(req.body);
  const account = await prisma.bankAccount.create({ data: { organizationId: req.organizationId!, ...input } });
  res.status(201).json(successResponse(account, 'Bank account added'));
});

router.get('/accounts/:id', async (req: Request, res: Response) => {
  const account = await prisma.bankAccount.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! } });
  res.json(successResponse(account));
});

router.put('/accounts/:id', async (req: Request, res: Response) => {
  const input = BankAccountSchema.partial().parse(req.body);
  const account = await prisma.bankAccount.update({ where: { id: req.params.id }, data: input });
  res.json(successResponse(account));
});

// ─── Bank Transactions ────────────────────────────────────────────────────────
router.get('/accounts/:id/transactions', async (req: Request, res: Response) => {
  const { page = 1, limit = 20, fromDate, toDate } = req.query as any;
  const where: Prisma.BankTransactionWhereInput = {
    bankAccountId: req.params.id,
    ...(fromDate && { transactionDate: { gte: new Date(fromDate) } }),
    ...(toDate && { transactionDate: { lte: new Date(toDate) } }),
  };
  const [data, total] = await Promise.all([
    prisma.bankTransaction.findMany({ where, skip: (+page - 1) * +limit, take: +limit, orderBy: { transactionDate: 'desc' } }),
    prisma.bankTransaction.count({ where }),
  ]);
  res.json(paginatedResponse(data, { page: +page, limit: +limit, total, totalPages: Math.ceil(total / +limit) }));
});

const BankTransactionSchema = z.object({
  transactionDate: z.coerce.date(),
  type: z.enum(['CREDIT', 'DEBIT']),
  amount: z.number().positive(),
  description: z.string(),
  referenceNumber: z.string().optional(),
});

router.post('/accounts/:id/transactions', async (req: Request, res: Response) => {
  const input = BankTransactionSchema.parse(req.body);
  const account = await prisma.bankAccount.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! } });
  if (!account) return res.status(404).json({ error: 'Bank account not found' });

  const newBalance = input.type === 'CREDIT' ? Number(account.currentBalance) + input.amount : Number(account.currentBalance) - input.amount;

  await prisma.$transaction(async (tx) => {
    await tx.bankTransaction.create({ data: { bankAccountId: req.params.id, transactionDate: input.transactionDate, type: input.type as any, amount: input.amount, description: input.description, referenceNumber: input.referenceNumber } });
    await tx.bankAccount.update({ where: { id: req.params.id }, data: { currentBalance: newBalance } });
  });

  res.status(201).json(successResponse({ message: 'Transaction recorded' }));
});

// ─── Reconciliation ───────────────────────────────────────────────────────────
router.get('/accounts/:id/reconcile', async (req: Request, res: Response) => {
  const account = await prisma.bankAccount.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! } });
  const unreconciled = await prisma.bankTransaction.findMany({ where: { bankAccountId: req.params.id, isReconciled: false }, orderBy: { transactionDate: 'desc' } });
  res.json(successResponse({ account, unreconciledTransactions: unreconciled }));
});

router.post('/accounts/:id/reconcile', async (req: Request, res: Response) => {
  const { transactionIds } = req.body as { transactionIds: string[] };
  await prisma.bankTransaction.updateMany({ where: { id: { in: transactionIds }, bankAccountId: req.params.id }, data: { isReconciled: true, reconciledAt: new Date() } });
  res.json(successResponse({ message: 'Transactions reconciled' }));
});

export { router as bankingRouter };
