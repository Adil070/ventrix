import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse, paginatedResponse, roundTo } from '../../shared/helpers/response.helper';
import { NotFoundError, BadRequestError } from '../../shared/errors';
import { paymentOrgScope } from '../payments/payment.service';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { AccountingEngine } from './accounting.engine';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

const accountingEngine = new AccountingEngine();
const router = Router();

/** Start of the current Indian financial year (1 April). */
export function financialYearStart(now = new Date()): Date {
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(year, 3, 1);
}

/** Parse a report date; a bare YYYY-MM-DD used as an upper bound means the end of that day. */
function parseDate(value: unknown, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const str = String(value);
  const d = new Date(str);
  if (isNaN(d.getTime())) throw new BadRequestError(`Invalid date: ${str}`);
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(str)) d.setUTCHours(23, 59, 59, 999);
  return d;
}

/** Ensure every account id belongs to the organisation. */
async function assertOwnAccounts(organizationId: string, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return;
  const found = await prisma.account.count({ where: { id: { in: unique }, organizationId } });
  if (found !== unique.length) throw new NotFoundError('Account');
}
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
  if (parentId) await assertOwnAccounts(req.organizationId!, [parentId]);
  const account = await prisma.account.create({
    data: { organizationId: req.organizationId!, name, code, type, subType, parentId, description, openingBalance: openingBalance ?? 0 },
  });
  res.status(201).json(successResponse(account));
});

router.get('/accounts/:id', async (req: Request, res: Response) => {
  const account = await prisma.account.findFirst({ where: { id: req.params.id, organizationId: req.organizationId! } });
  if (!account) throw new NotFoundError('Account');
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
  await assertOwnAccounts(req.organizationId!, input.lines.map(l => l.accountId));

  const count = await prisma.journalEntry.count({ where: { organizationId: req.organizationId! } });
  const entry = await prisma.$transaction(async (tx) => {
    const je = await tx.journalEntry.create({
      data: {
        organizationId: req.organizationId!, entryNumber: `JE-${String(count + 1).padStart(5, '0')}`,
        date: input.date, description: input.description, type: input.type as any,
        totalDebit, totalCredit, referenceId: input.referenceNumber, createdBy: req.userId,
        // Reports only read posted entries; a manual entry is final once saved.
        isPosted: true, postedAt: new Date(),
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
  const result = await accountingEngine.getTrialBalance(req.organizationId!, parseDate(asOfDate, true) ?? new Date());
  res.json(successResponse(result));
});
router.get('/trial-balance', async (req: Request, res: Response) => {
  const { asOfDate } = req.query as any;
  const result = await accountingEngine.getTrialBalance(req.organizationId!, parseDate(asOfDate, true) ?? new Date());
  res.json(successResponse(result));
});

// ─── Balance Sheet ────────────────────────────────────────────────────────────
router.get('/reports/balance-sheet', async (req: Request, res: Response) => {
  const { asOfDate, date } = req.query as any;
  const d = asOfDate || date;
  const result = await accountingEngine.getBalanceSheet(req.organizationId!, parseDate(d, true) ?? new Date());
  res.json(successResponse(result));
});
router.get('/balance-sheet', async (req: Request, res: Response) => {
  const { asOfDate, date } = req.query as any;
  const d = asOfDate || date;
  const result = await accountingEngine.getBalanceSheet(req.organizationId!, parseDate(d, true) ?? new Date());
  res.json(successResponse(result));
});

// ─── Profit & Loss ────────────────────────────────────────────────────────────
router.get('/reports/profit-loss', async (req: Request, res: Response) => {
  const { fromDate, toDate, startDate, endDate } = req.query as any;
  // Default period: current Indian financial year to date.
  const from = parseDate(fromDate || startDate) ?? financialYearStart();
  const to = parseDate(toDate || endDate, true) ?? new Date();
  const result = await accountingEngine.getProfitAndLoss(req.organizationId!, from, to);
  res.json(successResponse(result));
});
router.get('/profit-loss', async (req: Request, res: Response) => {
  const { fromDate, toDate, startDate, endDate } = req.query as any;
  // Default period: current Indian financial year to date.
  const from = parseDate(fromDate || startDate) ?? financialYearStart();
  const to = parseDate(toDate || endDate, true) ?? new Date();
  const result = await accountingEngine.getProfitAndLoss(req.organizationId!, from, to);
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
  const from = parseDate(fromDate) ?? financialYearStart();
  const to = parseDate(toDate, true) ?? new Date();
  const organizationId = req.organizationId!;

  // Real money in/out: every receipt (invoice payments, /payments receipts), every supplier payment
  // (incl. amounts paid at purchase time) and every expense (expenses are recorded as paid).
  const paymentWhere = (type: string): Prisma.PaymentWhereInput => ({
    AND: [paymentOrgScope(organizationId), { type, paymentDate: { gte: from, lte: to }, status: { not: 'FAILED' } }],
  });
  const [receipts, payments, expenses] = await Promise.all([
    prisma.payment.aggregate({ where: paymentWhere('RECEIPT'), _sum: { amount: true } }),
    prisma.payment.aggregate({ where: paymentWhere('PAYMENT'), _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { organizationId, expenseDate: { gte: from, lte: to }, status: { not: 'REJECTED' } }, _sum: { totalAmount: true } }),
  ]);

  const customerReceipts = Number(receipts._sum.amount ?? 0);
  const supplierPayments = Number(payments._sum.amount ?? 0);
  const expensePayments = Number(expenses._sum.totalAmount ?? 0);
  const operatingInflow = roundTo(customerReceipts);
  const operatingOutflow = roundTo(supplierPayments + expensePayments);
  const result = {
    period: { from, to },
    operatingActivities: {
      inflow: operatingInflow, outflow: operatingOutflow, net: roundTo(operatingInflow - operatingOutflow),
      breakdown: { customerReceipts, supplierPayments, expenses: expensePayments },
    },
    investingActivities: { inflow: 0, outflow: 0, net: 0 },
    financingActivities: { inflow: 0, outflow: 0, net: 0 },
    netCashFlow: roundTo(operatingInflow - operatingOutflow),
  };
  res.json(successResponse(result));
});

export { router as accountingRouter };
