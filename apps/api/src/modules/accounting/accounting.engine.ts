import { prisma } from '../../infrastructure/database';
import { toDecimal, roundTo } from '../../shared/helpers/response.helper';

type JournalLine = { accountId: string; debitAmount: number; creditAmount: number; description: string };

/** Payment modes that settle through a bank (everything else is treated as cash). */
const BANK_MODES = ['CARD', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'WALLET'];

/** Expense category keywords → default chart-of-accounts code (see createDefaultAccounts in auth.service). */
const EXPENSE_CATEGORY_CODES: Array<[RegExp, string]> = [
  [/salar|wage|payroll|staff|bonus/i, '6000'],
  [/rent|lease/i, '6100'],
  [/utilit|electric|power|water|internet|phone|telecom/i, '6200'],
  [/market|advert|promot|campaign/i, '6400'],
  [/depreciat/i, '6500'],
  [/bank|charge|fee|commission/i, '6600'],
  [/travel|transport|fuel|conveyance|freight|courier/i, '6700'],
  [/office|stationer|suppl|general|misc/i, '6300'],
];
const DEFAULT_EXPENSE_CODE = '6300'; // Office Expenses — the general operating expense account

/**
 * Double-Entry Accounting Engine
 * Implements the fundamental accounting equation: Assets = Liabilities + Equity
 * Every transaction creates balanced journal entries (debits = credits).
 *
 * All post* methods must be called with the Prisma transaction client of the business
 * record they belong to, so the record and its journal entry commit (or fail) together.
 * They return false (and post nothing) when the organisation has no chart of accounts.
 */
export class AccountingEngine {
  // ─── Post Sales Invoice Entry ─────────────────────────────────────────────────
  // Dr Accounts Receivable (total) / Cr Sales (net of tax, incl. round-off) / Cr GST payable / Cr Sales (shipping)
  async postSalesEntry(tx: any, invoice: any, organizationId: string): Promise<boolean> {
    const accounts = await this.getSystemAccounts(organizationId);
    if (!accounts.ACCOUNTS_RECEIVABLE || !accounts.SALES_REVENUE) return false;

    const total = toDecimal(invoice.totalAmount);
    const cgst = toDecimal(invoice.cgstAmount);
    const sgst = toDecimal(invoice.sgstAmount);
    const igst = toDecimal(invoice.igstAmount);
    const shipping = toDecimal(invoice.shippingCharges);
    // Sales is the balancing figure so round-off and per-line rounding never unbalance the entry.
    const sales = roundTo(total - cgst - sgst - igst - shipping);

    const lines: JournalLine[] = [
      { accountId: accounts.ACCOUNTS_RECEIVABLE, debitAmount: total, creditAmount: 0, description: `Sales Invoice ${invoice.invoiceNumber}` },
      { accountId: accounts.SALES_REVENUE, debitAmount: 0, creditAmount: sales, description: `Sales - ${invoice.invoiceNumber}` },
    ];
    if (cgst) lines.push({ accountId: accounts.CGST_PAYABLE!, debitAmount: 0, creditAmount: cgst, description: `CGST - ${invoice.invoiceNumber}` });
    if (sgst) lines.push({ accountId: accounts.SGST_PAYABLE!, debitAmount: 0, creditAmount: sgst, description: `SGST - ${invoice.invoiceNumber}` });
    if (igst) lines.push({ accountId: accounts.IGST_PAYABLE!, debitAmount: 0, creditAmount: igst, description: `IGST - ${invoice.invoiceNumber}` });
    if (shipping) lines.push({ accountId: accounts.SALES_REVENUE, debitAmount: 0, creditAmount: shipping, description: `Shipping - ${invoice.invoiceNumber}` });

    await this.createJournalEntry(tx, {
      organizationId,
      entryNumber: `JE-SALE-${invoice.invoiceNumber}`,
      type: 'SALES',
      referenceType: 'INVOICE',
      referenceId: invoice.id,
      invoiceId: invoice.id,
      date: invoice.invoiceDate,
      description: `Sales Invoice ${invoice.invoiceNumber}`,
      lines,
    });
    return true;
  }

  // ─── Post Purchase Entry ──────────────────────────────────────────────────────
  // Dr Purchases (net of GST, incl. shipping/round-off) / Dr GST (input credit, netted on the GST accounts) / Cr Accounts Payable (total)
  // Any amount paid at purchase time is a separate PAYMENT entry (postPaymentEntry) on its Payment row.
  async postPurchaseEntry(tx: any, purchase: any, organizationId: string): Promise<boolean> {
    const accounts = await this.getSystemAccounts(organizationId);
    if (!accounts.PURCHASES || !accounts.ACCOUNTS_PAYABLE) return false;

    const total = toDecimal(purchase.totalAmount);
    const cgst = toDecimal(purchase.cgstAmount);
    const sgst = toDecimal(purchase.sgstAmount);
    const igst = toDecimal(purchase.igstAmount);
    const purchases = roundTo(total - cgst - sgst - igst);

    const lines: JournalLine[] = [
      { accountId: accounts.PURCHASES, debitAmount: purchases, creditAmount: 0, description: `Purchase ${purchase.purchaseNumber}` },
    ];
    if (cgst) lines.push({ accountId: accounts.CGST_PAYABLE!, debitAmount: cgst, creditAmount: 0, description: `CGST Input - ${purchase.purchaseNumber}` });
    if (sgst) lines.push({ accountId: accounts.SGST_PAYABLE!, debitAmount: sgst, creditAmount: 0, description: `SGST Input - ${purchase.purchaseNumber}` });
    if (igst) lines.push({ accountId: accounts.IGST_PAYABLE!, debitAmount: igst, creditAmount: 0, description: `IGST Input - ${purchase.purchaseNumber}` });
    lines.push({ accountId: accounts.ACCOUNTS_PAYABLE, debitAmount: 0, creditAmount: total, description: `Purchase Payable - ${purchase.purchaseNumber}` });

    await this.createJournalEntry(tx, {
      organizationId,
      entryNumber: `JE-PUR-${purchase.purchaseNumber}`,
      type: 'PURCHASE',
      referenceType: 'PURCHASE',
      referenceId: purchase.id,
      purchaseId: purchase.id,
      date: purchase.purchaseDate,
      description: `Purchase ${purchase.purchaseNumber}`,
      lines,
    });
    return true;
  }

  // ─── Post Receipt Entry (Customer Payment) ────────────────────────────────────
  // Dr Cash/Bank (by bank account or payment mode) / Cr Accounts Receivable.
  // `invoice` is optional: a receipt recorded via /payments may be on account or span several invoices.
  async postReceiptEntry(tx: any, payment: any, invoice: any | null, organizationId: string): Promise<boolean> {
    const accounts = await this.getSystemAccounts(organizationId);
    if (!accounts.ACCOUNTS_RECEIVABLE) return false;
    const cashOrBank = await this.getCashOrBankAccount(tx, organizationId, accounts, payment.mode, payment.bankAccountId);
    if (!cashOrBank) return false;

    const ref = invoice?.invoiceNumber ?? payment.paymentNumber;
    const amount = toDecimal(payment.amount);
    await this.createJournalEntry(tx, {
      organizationId,
      entryNumber: `JE-REC-${payment.paymentNumber}`,
      type: 'RECEIPT',
      referenceType: 'PAYMENT',
      referenceId: payment.id,
      paymentId: payment.id,
      invoiceId: invoice?.id,
      date: payment.paymentDate,
      description: invoice ? `Payment received for ${invoice.invoiceNumber}` : `Payment received ${payment.paymentNumber}`,
      lines: [
        { accountId: cashOrBank, debitAmount: amount, creditAmount: 0, description: `Receipt - ${ref}` },
        { accountId: accounts.ACCOUNTS_RECEIVABLE, debitAmount: 0, creditAmount: amount, description: `Payment against ${ref}` },
      ],
    });
    return true;
  }

  // ─── Post Payment Entry (Supplier Payment) ────────────────────────────────────
  // Dr Accounts Payable / Cr Cash/Bank (by bank account or payment mode). `purchase` is optional.
  async postPaymentEntry(tx: any, payment: any, purchase: any | null, organizationId: string): Promise<boolean> {
    const accounts = await this.getSystemAccounts(organizationId);
    if (!accounts.ACCOUNTS_PAYABLE) return false;
    const cashOrBank = await this.getCashOrBankAccount(tx, organizationId, accounts, payment.mode, payment.bankAccountId);
    if (!cashOrBank) return false;

    const ref = purchase?.purchaseNumber ?? payment.paymentNumber;
    const amount = toDecimal(payment.amount);
    await this.createJournalEntry(tx, {
      organizationId,
      entryNumber: `JE-PAY-${payment.paymentNumber}`,
      type: 'PAYMENT',
      referenceType: 'PAYMENT',
      referenceId: payment.id,
      paymentId: payment.id,
      purchaseId: purchase?.id,
      date: payment.paymentDate,
      description: purchase ? `Payment for ${purchase.purchaseNumber}` : `Payment made ${payment.paymentNumber}`,
      lines: [
        { accountId: accounts.ACCOUNTS_PAYABLE, debitAmount: amount, creditAmount: 0, description: `Payment - ${ref}` },
        { accountId: cashOrBank, debitAmount: 0, creditAmount: amount, description: `Payment to supplier - ${ref}` },
      ],
    });
    return true;
  }

  // ─── Post Expense Entry ───────────────────────────────────────────────────────
  // Dr expense account (mapped from the category name, default Office Expenses) / Cr Cash/Bank.
  async postExpenseEntry(tx: any, expense: any, categoryName: string | null | undefined, organizationId: string): Promise<boolean> {
    const accounts = await this.getSystemAccounts(organizationId);
    const expenseAccount = await this.getExpenseAccount(tx, organizationId, categoryName);
    const cashOrBank = await this.getCashOrBankAccount(tx, organizationId, accounts, expense.paymentMode, expense.bankAccountId);
    if (!expenseAccount || !cashOrBank) return false;

    const amount = toDecimal(expense.totalAmount ?? expense.amount);
    await this.createJournalEntry(tx, {
      organizationId,
      entryNumber: `JE-EXP-${expense.expenseNumber}`,
      type: 'PAYMENT',
      referenceType: 'EXPENSE',
      referenceId: expense.id,
      date: expense.expenseDate,
      description: `Expense ${expense.expenseNumber} - ${expense.title}`,
      lines: [
        { accountId: expenseAccount, debitAmount: amount, creditAmount: 0, description: expense.title },
        { accountId: cashOrBank, debitAmount: 0, creditAmount: amount, description: `Paid - ${expense.expenseNumber}` },
      ],
    });
    return true;
  }

  // ─── Post Credit Note (sales return) ──────────────────────────────────────────
  // Reverses the sale for the returned goods: Dr Sales (net) / Dr GST payable (output tax given back) / Cr Accounts Receivable (total).
  // A credit larger than what the customer still owes leaves Receivable in credit — that is the customer's open credit.
  async postCreditNoteEntry(
    tx: any,
    note: { id: string; noteNumber: string; amount: unknown },
    ctx: { taxAmount: number; interState: boolean; invoiceId?: string | null; date?: Date },
    organizationId: string,
  ): Promise<boolean> {
    const accounts = await this.getSystemAccounts(organizationId);
    if (!accounts.ACCOUNTS_RECEIVABLE || !accounts.SALES_REVENUE) return false;
    const total = toDecimal(note.amount);
    const { cgst, sgst, igst } = this.splitTax(ctx.taxAmount, ctx.interState);
    const lines: JournalLine[] = [
      { accountId: accounts.SALES_REVENUE, debitAmount: roundTo(total - cgst - sgst - igst), creditAmount: 0, description: `Sales return - ${note.noteNumber}` },
      { accountId: accounts.CGST_PAYABLE!, debitAmount: cgst, creditAmount: 0, description: `CGST reversed - ${note.noteNumber}` },
      { accountId: accounts.SGST_PAYABLE!, debitAmount: sgst, creditAmount: 0, description: `SGST reversed - ${note.noteNumber}` },
      { accountId: accounts.IGST_PAYABLE!, debitAmount: igst, creditAmount: 0, description: `IGST reversed - ${note.noteNumber}` },
      { accountId: accounts.ACCOUNTS_RECEIVABLE, debitAmount: 0, creditAmount: total, description: `Credit note ${note.noteNumber}` },
    ].filter(l => l.debitAmount || l.creditAmount);
    await this.createJournalEntry(tx, {
      organizationId,
      entryNumber: `JE-CN-${note.noteNumber}`,
      type: 'CREDIT_NOTE',
      referenceType: 'CREDIT_NOTE',
      referenceId: note.id,
      invoiceId: ctx.invoiceId ?? undefined,
      date: ctx.date ?? new Date(),
      description: `Credit note ${note.noteNumber}`,
      lines,
    });
    return true;
  }

  // ─── Post Debit Note (purchase return) ────────────────────────────────────────
  // Reverses the purchase for the returned goods: Dr Accounts Payable (total) / Cr Purchases (net) / Cr GST (input credit given back).
  async postDebitNoteEntry(
    tx: any,
    note: { id: string; noteNumber: string; amount: unknown },
    ctx: { taxAmount: number; interState: boolean; purchaseId?: string | null; date?: Date },
    organizationId: string,
  ): Promise<boolean> {
    const accounts = await this.getSystemAccounts(organizationId);
    if (!accounts.PURCHASES || !accounts.ACCOUNTS_PAYABLE) return false;
    const total = toDecimal(note.amount);
    const { cgst, sgst, igst } = this.splitTax(ctx.taxAmount, ctx.interState);
    const lines: JournalLine[] = [
      { accountId: accounts.ACCOUNTS_PAYABLE, debitAmount: total, creditAmount: 0, description: `Debit note ${note.noteNumber}` },
      { accountId: accounts.PURCHASES, debitAmount: 0, creditAmount: roundTo(total - cgst - sgst - igst), description: `Purchase return - ${note.noteNumber}` },
      { accountId: accounts.CGST_PAYABLE!, debitAmount: 0, creditAmount: cgst, description: `CGST input reversed - ${note.noteNumber}` },
      { accountId: accounts.SGST_PAYABLE!, debitAmount: 0, creditAmount: sgst, description: `SGST input reversed - ${note.noteNumber}` },
      { accountId: accounts.IGST_PAYABLE!, debitAmount: 0, creditAmount: igst, description: `IGST input reversed - ${note.noteNumber}` },
    ].filter(l => l.debitAmount || l.creditAmount);
    await this.createJournalEntry(tx, {
      organizationId,
      entryNumber: `JE-DN-${note.noteNumber}`,
      type: 'DEBIT_NOTE',
      referenceType: 'DEBIT_NOTE',
      referenceId: note.id,
      purchaseId: ctx.purchaseId ?? undefined,
      date: ctx.date ?? new Date(),
      description: `Debit note ${note.noteNumber}`,
      lines,
    });
    return true;
  }

  /** GST split the same way invoices store it: IGST when inter-state, otherwise CGST and SGST halves. */
  private splitTax(taxAmount: number, interState: boolean) {
    const tax = roundTo(toDecimal(taxAmount));
    if (interState) return { cgst: 0, sgst: 0, igst: tax };
    const cgst = roundTo(tax / 2);
    return { cgst, sgst: roundTo(tax - cgst), igst: 0 };
  }

  // ─── Reverse Entries ──────────────────────────────────────────────────────────
  // Posts a mirror entry (debits ↔ credits) for every posted, not-yet-reversed entry matching `where`.
  // Reversals are dated `date` (the cancellation/edit date) so closed periods are not rewritten.
  async reverseEntries(
    tx: any,
    organizationId: string,
    where: { purchaseId?: string; invoiceId?: string; paymentId?: string; referenceType?: string; referenceId?: string },
    date: Date,
    reason: string,
  ): Promise<number> {
    const entries: any[] = await tx.journalEntry.findMany({
      where: { organizationId, isPosted: true, ...where },
      include: { lines: true },
    });
    const originals = entries.filter(e => e.referenceType !== 'REVERSAL');
    if (!originals.length) return 0;

    const already: any[] = await tx.journalEntry.findMany({
      where: { organizationId, referenceType: 'REVERSAL', referenceId: { in: originals.map(e => e.id) } },
      select: { referenceId: true },
    });
    const reversed = new Set(already.map(e => e.referenceId));

    let count = 0;
    for (const entry of originals) {
      if (reversed.has(entry.id)) continue;
      await this.createJournalEntry(tx, {
        organizationId,
        entryNumber: `REV-${entry.entryNumber}`,
        type: 'JOURNAL',
        referenceType: 'REVERSAL',
        referenceId: entry.id,
        invoiceId: entry.invoiceId ?? undefined,
        purchaseId: entry.purchaseId ?? undefined,
        paymentId: entry.paymentId ?? undefined,
        date,
        description: `Reversal of ${entry.entryNumber}: ${reason}`,
        lines: entry.lines.map((l: any) => ({
          accountId: l.accountId,
          debitAmount: toDecimal(l.creditAmount),
          creditAmount: toDecimal(l.debitAmount),
          description: `Reversal - ${l.description ?? entry.entryNumber}`,
        })),
      });
      count++;
    }
    return count;
  }

  // ─── Get Trial Balance ────────────────────────────────────────────────────────
  async getTrialBalance(organizationId: string, asOfDate: Date) {
    const accounts = await prisma.account.findMany({
      where: { organizationId, isActive: true },
      include: {
        debitLines: {
          where: { journalEntry: { date: { lte: asOfDate }, isPosted: true } },
          select: { debitAmount: true, creditAmount: true },
        },
      },
      orderBy: { code: 'asc' },
    });

    return accounts.map(account => {
      const totalDebit = account.debitLines.reduce((sum, l) => sum + toDecimal(l.debitAmount), 0);
      const totalCredit = account.debitLines.reduce((sum, l) => sum + toDecimal(l.creditAmount), 0);
      const openingBalance = toDecimal(account.openingBalance);

      const debitBalance = totalDebit + (this.isDebitNature(account.type) ? openingBalance : 0);
      const creditBalance = totalCredit + (this.isDebitNature(account.type) ? 0 : openingBalance);

      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        debit: roundTo(debitBalance),
        credit: roundTo(creditBalance),
        balance: roundTo(debitBalance - creditBalance),
      };
    });
  }

  // ─── Get P&L ──────────────────────────────────────────────────────────────────
  // operatingExpenses keeps its historical meaning for the UI (all EXPENSE accounts, COGS included);
  // netProfit = revenue − all expenses.
  async getProfitAndLoss(organizationId: string, from: Date, to: Date) {
    const [revenue, expenses, cogs] = await Promise.all([
      this.getAccountTotals(organizationId, 'REVENUE', from, to),
      this.getAccountTotals(organizationId, 'EXPENSE', from, to),
      this.getAccountTotals(organizationId, 'EXPENSE', from, to, 'COST_OF_GOODS_SOLD'),
    ]);

    // Purchases are booked as an expense when bought, but stock still on the shelf hasn't been "used" yet.
    // Trading accounts: cost of goods sold = opening stock + purchases - closing stock (valued at cost).
    const [openingStock, closingStock] = await Promise.all([
      this.getStockValue(organizationId, new Date(from.getTime() - 1)),
      this.getStockValue(organizationId, to),
    ]);
    const stockLines = [
      { accountId: 'stock-opening', code: 'STOCK', name: 'Opening stock', balance: openingStock },
      { accountId: 'stock-closing', code: 'STOCK', name: 'Less: closing stock', balance: roundTo(-closingStock) },
    ];
    const stockChange = roundTo(openingStock - closingStock);
    const costOfGoodsSold = {
      breakdown: [...cogs.breakdown, ...stockLines],
      total: roundTo(cogs.total + stockChange),
    };
    const allExpenses = {
      breakdown: [...expenses.breakdown, ...stockLines],
      total: roundTo(expenses.total + stockChange),
    };

    const grossProfit = roundTo(revenue.total - costOfGoodsSold.total);
    const otherExpenses = roundTo(expenses.total - cogs.total);
    const netProfit = roundTo(grossProfit - otherExpenses);

    return {
      period: { from, to },
      revenue,
      cogs: costOfGoodsSold,
      stock: { opening: openingStock, closing: closingStock, purchases: cogs.total },
      grossProfit,
      operatingExpenses: allExpenses,
      totalExpenses: allExpenses.total,
      expensesExcludingCogs: otherExpenses,
      netProfit,
      grossMargin: revenue.total > 0 ? roundTo((grossProfit / revenue.total) * 100) : 0,
      netMargin: revenue.total > 0 ? roundTo((netProfit / revenue.total) * 100) : 0,
    };
  }

  /** Value of stock on hand at `asOf`: quantity from stock movements up to then × the item's cost price. */
  private async getStockValue(organizationId: string, asOf: Date): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ value: unknown }>>`
      SELECT COALESCE(SUM(q.qty * p."costPrice"), 0) AS value
      FROM (
        SELECT se."productId", SUM(se.quantity) AS qty
        FROM stock_entries se
        WHERE se."organizationId" = ${organizationId} AND se."createdAt" <= ${asOf}
        GROUP BY se."productId"
      ) q
      JOIN products p ON p.id = q."productId"
      WHERE p."organizationId" = ${organizationId} AND p."trackInventory" = true AND q.qty > 0`;
    return roundTo(toDecimal(rows[0]?.value));
  }

  // ─── Get Balance Sheet ────────────────────────────────────────────────────────
  // Includes account opening balances the same way the trial balance does.
  async getBalanceSheet(organizationId: string, asOfDate: Date) {
    const [assets, liabilities, equity] = await Promise.all([
      this.getAccountTotals(organizationId, 'ASSET', new Date(0), asOfDate, undefined, true),
      this.getAccountTotals(organizationId, 'LIABILITY', new Date(0), asOfDate, undefined, true),
      this.getAccountTotals(organizationId, 'EQUITY', new Date(0), asOfDate, undefined, true),
    ]);

    // Stock on hand is an asset. Profit & Loss counts it (closing stock), so the balance sheet must too.
    const stockInHand = await this.getStockValue(organizationId, asOfDate);
    const assetsWithStock = stockInHand
      ? {
          breakdown: [...assets.breakdown, { accountId: 'stock-in-hand', code: 'STOCK', name: 'Stock in hand (at cost)', balance: stockInHand }],
          total: roundTo(assets.total + stockInHand),
        }
      : assets;

    return { assets: assetsWithStock, liabilities, equity };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────
  private isDebitNature(type: string) {
    return type === 'ASSET' || type === 'EXPENSE';
  }

  private async createJournalEntry(tx: any, data: {
    organizationId: string;
    entryNumber: string;
    type: string;
    referenceType?: string;
    referenceId?: string;
    invoiceId?: string;
    purchaseId?: string;
    paymentId?: string;
    date: Date;
    description: string;
    lines: JournalLine[];
  }) {
    // Normalise: round, flip negative amounts to the other side, drop zero lines.
    const lines = data.lines
      .map(l => {
        const net = roundTo(toDecimal(l.debitAmount) - toDecimal(l.creditAmount));
        return { ...l, debitAmount: net > 0 ? net : 0, creditAmount: net < 0 ? -net : 0 };
      })
      .filter(l => l.debitAmount > 0 || l.creditAmount > 0);

    if (lines.some(l => !l.accountId)) {
      throw new Error(`Journal entry ${data.entryNumber} references a missing ledger account`);
    }

    const totalDebit = roundTo(lines.reduce((sum, l) => sum + l.debitAmount, 0));
    const totalCredit = roundTo(lines.reduce((sum, l) => sum + l.creditAmount, 0));

    if (Math.abs(totalDebit - totalCredit) >= 0.005) {
      throw new Error(`Journal entry is not balanced: debit=${totalDebit}, credit=${totalCredit}`);
    }
    if (!lines.length) return;

    await tx.journalEntry.create({
      data: {
        organizationId: data.organizationId,
        entryNumber: data.entryNumber,
        type: data.type as any,
        referenceType: data.referenceType,
        referenceId: data.referenceId,
        invoiceId: data.invoiceId,
        purchaseId: data.purchaseId,
        paymentId: data.paymentId,
        date: data.date ?? new Date(),
        description: data.description,
        totalDebit,
        totalCredit,
        isPosted: true,
        postedAt: new Date(),
        lines: {
          create: lines.map((line, idx) => ({
            accountId: line.accountId,
            debitAmount: line.debitAmount,
            creditAmount: line.creditAmount,
            description: line.description,
            sortOrder: idx,
          })),
        },
      },
    });
  }

  private systemAccounts: Record<string, Record<string, string>> = {};

  private async getSystemAccounts(organizationId: string): Promise<Record<string, string | undefined>> {
    if (this.systemAccounts[organizationId]) {
      return this.systemAccounts[organizationId];
    }

    const accounts = await prisma.account.findMany({
      where: { organizationId, isSystem: true },
      select: { id: true, subType: true, code: true },
    });

    // Accounts are looked up by the fixed codes of the default chart (auth.service createDefaultAccounts);
    // subType is only used for the subtypes that are unique in that chart.
    const map: Record<string, string> = {};
    for (const acc of accounts) {
      if (acc.subType && ['CASH', 'BANK', 'ACCOUNTS_RECEIVABLE', 'ACCOUNTS_PAYABLE'].includes(acc.subType)) {
        map[acc.subType] ??= acc.id;
      }
      if (acc.code === '1000') map['CASH'] = acc.id;
      if (acc.code === '1100') map['BANK'] = acc.id;
      if (acc.code === '1200') map['ACCOUNTS_RECEIVABLE'] = acc.id;
      if (acc.code === '2000') map['ACCOUNTS_PAYABLE'] = acc.id;
      if (acc.code === '4000') map['SALES_REVENUE'] = acc.id;
      if (acc.code === '5100') map['PURCHASES'] = acc.id;
      if (acc.code === '2200') map['CGST_PAYABLE'] = acc.id;
      if (acc.code === '2300') map['SGST_PAYABLE'] = acc.id;
      if (acc.code === '2400') map['IGST_PAYABLE'] = acc.id;
    }

    // Only cache a complete chart, so an org whose accounts are created later is picked up.
    if (map.CASH && map.ACCOUNTS_RECEIVABLE && map.ACCOUNTS_PAYABLE) this.systemAccounts[organizationId] = map;
    return map;
  }

  /** Ledger account a payment settles through: the bank account's linked ledger account, else Bank (non-cash modes) or Cash. */
  private async getCashOrBankAccount(
    tx: any,
    organizationId: string,
    accounts: Record<string, string | undefined>,
    mode: string | null | undefined,
    bankAccountId: string | null | undefined,
  ): Promise<string | undefined> {
    if (bankAccountId) {
      const bankAccount = await tx.bankAccount.findFirst({
        where: { id: bankAccountId, organizationId },
        select: { accountId: true },
      });
      if (bankAccount?.accountId) return bankAccount.accountId;
      return accounts.BANK ?? accounts.CASH;
    }
    if (mode && BANK_MODES.includes(mode)) return accounts.BANK ?? accounts.CASH;
    return accounts.CASH;
  }

  /** Expense ledger account for a category: exact account-name match, then keyword → default code, then Office Expenses. */
  private async getExpenseAccount(tx: any, organizationId: string, categoryName: string | null | undefined): Promise<string | undefined> {
    const expenseAccounts: Array<{ id: string; code: string; name: string; subType: string | null }> = await tx.account.findMany({
      where: { organizationId, type: 'EXPENSE', isActive: true },
      select: { id: true, code: true, name: true, subType: true },
    });
    if (!expenseAccounts.length) return undefined;
    const byCode = (code: string) => expenseAccounts.find(a => a.code === code)?.id;

    const name = (categoryName ?? '').trim();
    if (name) {
      const exact = expenseAccounts.find(a => a.name.toLowerCase() === name.toLowerCase() && a.subType !== 'COST_OF_GOODS_SOLD');
      if (exact) return exact.id;
      for (const [pattern, code] of EXPENSE_CATEGORY_CODES) {
        if (pattern.test(name) && byCode(code)) return byCode(code);
      }
    }
    return byCode(DEFAULT_EXPENSE_CODE)
      ?? expenseAccounts.find(a => a.subType === 'OPERATING_EXPENSE')?.id
      ?? expenseAccounts.find(a => a.subType !== 'COST_OF_GOODS_SOLD')?.id;
  }

  private async getAccountTotals(
    organizationId: string,
    type: string,
    from: Date,
    to: Date,
    subType?: string,
    includeOpening = false,
  ) {
    const accounts = await prisma.account.findMany({
      where: {
        organizationId,
        type: type as any,
        ...(subType && { subType: subType as any }),
      },
      include: {
        debitLines: {
          where: { journalEntry: { date: { gte: from, lte: to }, isPosted: true } },
          select: { debitAmount: true, creditAmount: true },
        },
      },
      orderBy: { code: 'asc' },
    });

    const breakdown = accounts.map(acc => {
      const totalDebit = acc.debitLines.reduce((s, l) => s + toDecimal(l.debitAmount), 0);
      const totalCredit = acc.debitLines.reduce((s, l) => s + toDecimal(l.creditAmount), 0);
      const opening = includeOpening ? toDecimal(acc.openingBalance) : 0;
      const balance = this.isDebitNature(type)
        ? totalDebit - totalCredit + opening
        : totalCredit - totalDebit + opening;

      return { accountId: acc.id, code: acc.code, name: acc.name, balance: roundTo(balance) };
    });

    return {
      breakdown,
      total: roundTo(breakdown.reduce((s, a) => s + a.balance, 0)),
    };
  }
}
