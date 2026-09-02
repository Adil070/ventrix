import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse, paginatedResponse } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { AccountingEngine } from './accounting.engine';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

const accountingEngine = new AccountingEngine();
const router = Router();
router.use(authMiddleware, tenantMiddleware);

// ─── Chart of Accounts ───────────────────────────────────────────────────────
router.get('/accounts', async (req: Request, res: Response) => {
  const accounts = await prisma.account.findMany({
    where: { organizationId: req.organizationId! },
    include: { parent: { select: { id: true, name: true, code: true } }, children: { select: { id: true, name: true, code: true } } },
    orderBy: { code: 'asc' },
  });
  res.json(successResponse(accounts));
});

router.post('/accounts', async (req: Request, res: Response) => {
  const { name, code, type, subType, parentId, description, openingBalance } = req.body;
  const account = await prisma.account.create({
    data: { organizationId: req.organizationId!, name, code, type, subType, parentId, description, openingBalance: openingBalance ?? 0 },
  });
  res.status(201).json(successResponse(account));
});

router.get('/accounts/:id', async (req: Request, res: Response) => {
  const account = await prisma.account.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! } });
  res.json(successResponse(account));
});

// ─── Journal Entries ─────────────────────────────────────────────────────────
router.get('/journal', async (req: Request, res: Response) => {
  const { page = 1, limit = 20, fromDate, toDate } = req.query as any;
  const where: Prisma.JournalEntryWhereInput = {
    organizationId: req.organizationId!,
    ...(fromDate && { date: { gte: new Date(fromDate) } }),
    ...(toDate && { date: { lte: new Date(toDate) } }),
  };
  const [data, total] = await Promise.all([
    prisma.journalEntry.findMany({ where, skip: (page - 1) * limit, take: +limit, orderBy: { date: 'desc' }, include: { lines: { include: { account: { select: { id: true, name: true, code: true } } } } } }),
    prisma.journalEntry.count({ where }),
  ]);
  res.json(paginatedResponse(data, { page: +page, limit: +limit, total, totalPages: Math.ceil(total / +limit) }));
});

const JournalEntrySchema = z.object({
  date: z.coerce.date(),
  description: z.string().optional(),
  type: z.enum(['JOURNAL', 'CONTRA', 'OPENING_BALANCE']).default('JOURNAL'),
  lines: z.array(z.object({
    accountId: z.string(),
    type: z.enum(['DEBIT', 'CREDIT']),
    amount: z.number().positive(),
    description: z.string().optional(),
  })).min(2),
  referenceNumber: z.string().optional(),
});

router.post('/journal', async (req: Request, res: Response) => {
  const input = JournalEntrySchema.parse(req.body);
  const totalDebit = input.lines.filter(l => l.type === 'DEBIT').reduce((s, l) => s + l.amount, 0);
  const totalCredit = input.lines.filter(l => l.type === 'CREDIT').reduce((s, l) => s + l.amount, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return res.status(400).json({ error: 'Journal entry must be balanced (debits = credits)' });
  }

  const count = await prisma.journalEntry.count({ where: { organizationId: req.organizationId! } });
  const entry = await prisma.$transaction(async (tx) => {
    const je = await tx.journalEntry.create({
      data: {
        organizationId: req.organizationId!, entryNumber: `JE-${String(count + 1).padStart(5, '0')}`,
        date: input.date, description: input.description, type: input.type as any,
        totalDebit, totalCredit, referenceId: input.referenceNumber, createdBy: req.userId,
        lines: { create: input.lines.map(l => ({
          accountId: l.accountId,
          debitAmount: l.type === 'DEBIT' ? l.amount : 0,
          creditAmount: l.type === 'CREDIT' ? l.amount : 0,
          description: l.description,
        })) },
      },
      include: { lines: true },
    });
    // Account balance updates are tracked via JournalEntryLine aggregates
    return je;
  });
  res.status(201).json(successResponse(entry));
});

// ─── Trial Balance ────────────────────────────────────────────────────────────
router.get('/reports/trial-balance', async (req: Request, res: Response) => {
  const { asOfDate } = req.query as any;
  const result = await accountingEngine.getTrialBalance(req.organizationId!, asOfDate ? new Date(asOfDate) : new Date());
  res.json(successResponse(result));
});
router.get('/trial-balance', async (req: Request, res: Response) => {
  const { asOfDate } = req.query as any;
  const result = await accountingEngine.getTrialBalance(req.organizationId!, asOfDate ? new Date(asOfDate) : new Date());
  res.json(successResponse(result));
});

// ─── Balance Sheet ────────────────────────────────────────────────────────────
router.get('/reports/balance-sheet', async (req: Request, res: Response) => {
  const { asOfDate, date } = req.query as any;
  const d = asOfDate || date;
  const result = await accountingEngine.getBalanceSheet(req.organizationId!, d ? new Date(d) : new Date());
  res.json(successResponse(result));
});
router.get('/balance-sheet', async (req: Request, res: Response) => {
  const { asOfDate, date } = req.query as any;
  const d = asOfDate || date;
  const result = await accountingEngine.getBalanceSheet(req.organizationId!, d ? new Date(d) : new Date());
  res.json(successResponse(result));
});

// ─── Profit & Loss ────────────────────────────────────────────────────────────
router.get('/reports/profit-loss', async (req: Request, res: Response) => {
  const { fromDate, toDate, startDate, endDate } = req.query as any;
  const from = fromDate || startDate;
  const to = toDate || endDate;
  const result = await accountingEngine.getProfitAndLoss(req.organizationId!, from ? new Date(from) : new Date(), to ? new Date(to) : new Date());
  res.json(successResponse(result));
});
router.get('/profit-loss', async (req: Request, res: Response) => {
  const { fromDate, toDate, startDate, endDate } = req.query as any;
  const from = fromDate || startDate;
  const to = toDate || endDate;
  const result = await accountingEngine.getProfitAndLoss(req.organizationId!, from ? new Date(from) : new Date(), to ? new Date(to) : new Date());
  res.json(successResponse(result));
});

// ─── General Ledger ────────────────────────────────────────────────────────────
router.get('/reports/general-ledger', async (req: Request, res: Response) => {
  const { accountId, fromDate, toDate } = req.query as any;
  const entries = await prisma.journalEntryLine.findMany({
    where: {
      account: { organizationId: req.organizationId! },
      ...(accountId && { accountId }),
      ...(fromDate && { journalEntry: { date: { gte: new Date(fromDate) } } }),
      ...(toDate && { journalEntry: { date: { lte: new Date(toDate) } } }),
    },
    include: { journalEntry: { select: { entryNumber: true, date: true, description: true } }, account: { select: { name: true, code: true } } },
    orderBy: { journalEntry: { date: 'asc' } },
  });
  res.json(successResponse(entries));
});

// ─── Day Book ─────────────────────────────────────────────────────────────────
router.get('/reports/day-book', async (req: Request, res: Response) => {
  const { date } = req.query as any;
  const targetDate = date ? new Date(date) : new Date();
  const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
  const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));
  const entries = await prisma.journalEntry.findMany({
    where: { organizationId: req.organizationId!, date: { gte: startOfDay, lte: endOfDay } },
    include: { lines: { include: { account: { select: { id: true, name: true, code: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(successResponse(entries));
});

// ─── Cash Flow Statement ──────────────────────────────────────────────────────
router.get('/reports/cash-flow', async (req: Request, res: Response) => {
  const { fromDate, toDate } = req.query as any;
  const from = fromDate ? new Date(fromDate) : new Date(new Date().getFullYear(), 0, 1);
  const to = toDate ? new Date(toDate) : new Date();

  // Compute simple cash flow from payments and bank transactions
  const [receipts, payments] = await Promise.all([
    prisma.payment.aggregate({
      where: { invoice: { organizationId: req.organizationId! }, paymentDate: { gte: from, lte: to }, type: 'RECEIPT' },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { purchase: { organizationId: req.organizationId! }, paymentDate: { gte: from, lte: to }, type: 'PAYMENT' },
      _sum: { amount: true },
    }),
  ]);

  const operatingInflow = Number(receipts._sum.amount ?? 0);
  const operatingOutflow = Number(payments._sum.amount ?? 0);
  const result = {
    period: { from, to },
    operatingActivities: { inflow: operatingInflow, outflow: operatingOutflow, net: operatingInflow - operatingOutflow },
    investingActivities: { inflow: 0, outflow: 0, net: 0 },
    financingActivities: { inflow: 0, outflow: 0, net: 0 },
    netCashFlow: operatingInflow - operatingOutflow,
  };
  res.json(successResponse(result));
});

export { router as accountingRouter };
