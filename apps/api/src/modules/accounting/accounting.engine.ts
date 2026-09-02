import { Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database';
import { toDecimal, roundTo } from '../../shared/helpers/response.helper';

/**
 * Double-Entry Accounting Engine
 * Implements the fundamental accounting equation: Assets = Liabilities + Equity
 * Every transaction creates balanced journal entries (debits = credits)
 */
export class AccountingEngine {
  // ─── Post Sales Invoice Entry ─────────────────────────────────────────────────
  async postSalesEntry(tx: any, invoice: any, organizationId: string): Promise<void> {
    const accounts = await this.getSystemAccounts(organizationId);

    const lines: Array<{ accountId: string; debitAmount: number; creditAmount: number; description: string }> = [];

    // Debit: Accounts Receivable (or Cash for POS)
    const receivableAccount = accounts.ACCOUNTS_RECEIVABLE;
    if (!receivableAccount) return;

    lines.push({
      accountId: receivableAccount,
      debitAmount: toDecimal(invoice.totalAmount),
      creditAmount: 0,
      description: `Sales Invoice ${invoice.invoiceNumber}`,
    });

    // Credit: Sales Revenue
    lines.push({
      accountId: accounts.SALES_REVENUE!,
      debitAmount: 0,
      creditAmount: toDecimal(invoice.taxableAmount) - toDecimal(invoice.discountAmount),
      description: `Sales - ${invoice.invoiceNumber}`,
    });

    // Credit: CGST Payable
    if (toDecimal(invoice.cgstAmount) > 0) {
      lines.push({
        accountId: accounts.CGST_PAYABLE!,
        debitAmount: 0,
        creditAmount: toDecimal(invoice.cgstAmount),
        description: `CGST - ${invoice.invoiceNumber}`,
      });
    }

    // Credit: SGST Payable
    if (toDecimal(invoice.sgstAmount) > 0) {
      lines.push({
        accountId: accounts.SGST_PAYABLE!,
        debitAmount: 0,
        creditAmount: toDecimal(invoice.sgstAmount),
        description: `SGST - ${invoice.invoiceNumber}`,
      });
    }

    // Credit: IGST Payable
    if (toDecimal(invoice.igstAmount) > 0) {
      lines.push({
        accountId: accounts.IGST_PAYABLE!,
        debitAmount: 0,
        creditAmount: toDecimal(invoice.igstAmount),
        description: `IGST - ${invoice.invoiceNumber}`,
      });
    }

    // Credit: Shipping (if applicable)
    if (toDecimal(invoice.shippingCharges) > 0) {
      lines.push({
        accountId: accounts.SALES_REVENUE!,
        debitAmount: 0,
        creditAmount: toDecimal(invoice.shippingCharges),
        description: `Shipping - ${invoice.invoiceNumber}`,
      });
    }

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
  }

  // ─── Post Purchase Entry ──────────────────────────────────────────────────────
  async postPurchaseEntry(tx: any, purchase: any, organizationId: string): Promise<void> {
    const accounts = await this.getSystemAccounts(organizationId);

    const lines = [];

    // Debit: Purchases/Inventory
    lines.push({
      accountId: accounts.PURCHASES!,
      debitAmount: toDecimal(purchase.taxableAmount),
      creditAmount: 0,
      description: `Purchase ${purchase.purchaseNumber}`,
    });

    // Debit: Input GST (recoverable)
    if (toDecimal(purchase.cgstAmount) > 0) {
      lines.push({
        accountId: accounts.CGST_PAYABLE!,
        debitAmount: toDecimal(purchase.cgstAmount),
        creditAmount: 0,
        description: `CGST Input - ${purchase.purchaseNumber}`,
      });
    }

    if (toDecimal(purchase.sgstAmount) > 0) {
      lines.push({
        accountId: accounts.SGST_PAYABLE!,
        debitAmount: toDecimal(purchase.sgstAmount),
        creditAmount: 0,
        description: `SGST Input - ${purchase.purchaseNumber}`,
      });
    }

    if (toDecimal(purchase.igstAmount) > 0) {
      lines.push({
        accountId: accounts.IGST_PAYABLE!,
        debitAmount: toDecimal(purchase.igstAmount),
        creditAmount: 0,
        description: `IGST Input - ${purchase.purchaseNumber}`,
      });
    }

    // Credit: Accounts Payable
    lines.push({
      accountId: accounts.ACCOUNTS_PAYABLE!,
      debitAmount: 0,
      creditAmount: toDecimal(purchase.totalAmount),
      description: `Purchase Payable - ${purchase.purchaseNumber}`,
    });

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
  }

  // ─── Post Receipt Entry (Customer Payment) ────────────────────────────────────
  async postReceiptEntry(tx: any, payment: any, invoice: any, organizationId: string): Promise<void> {
    const accounts = await this.getSystemAccounts(organizationId);

    // Debit: Cash/Bank
    const debitAccountId = payment.bankAccountId
      ? await this.getBankAccountId(payment.bankAccountId)
      : accounts.CASH!;

    const lines = [
      {
        accountId: debitAccountId,
        debitAmount: toDecimal(payment.amount),
        creditAmount: 0,
        description: `Receipt - ${invoice.invoiceNumber}`,
      },
      {
        accountId: accounts.ACCOUNTS_RECEIVABLE!,
        debitAmount: 0,
        creditAmount: toDecimal(payment.amount),
        description: `Payment against ${invoice.invoiceNumber}`,
      },
    ];

    await this.createJournalEntry(tx, {
      organizationId,
      entryNumber: `JE-REC-${payment.paymentNumber}`,
      type: 'RECEIPT',
      referenceType: 'PAYMENT',
      referenceId: payment.id,
      paymentId: payment.id,
      date: payment.paymentDate,
      description: `Payment received for ${invoice.invoiceNumber}`,
      lines,
    });
  }

  // ─── Post Payment Entry (Supplier Payment) ────────────────────────────────────
  async postPaymentEntry(tx: any, payment: any, purchase: any, organizationId: string): Promise<void> {
    const accounts = await this.getSystemAccounts(organizationId);

    const creditAccountId = payment.bankAccountId
      ? await this.getBankAccountId(payment.bankAccountId)
      : accounts.CASH!;

    const lines = [
      {
        accountId: accounts.ACCOUNTS_PAYABLE!,
        debitAmount: toDecimal(payment.amount),
        creditAmount: 0,
        description: `Payment - ${purchase.purchaseNumber}`,
      },
      {
        accountId: creditAccountId,
        debitAmount: 0,
        creditAmount: toDecimal(payment.amount),
        description: `Payment to supplier - ${purchase.purchaseNumber}`,
      },
    ];

    await this.createJournalEntry(tx, {
      organizationId,
      entryNumber: `JE-PAY-${payment.paymentNumber}`,
      type: 'PAYMENT',
      referenceType: 'PAYMENT',
      referenceId: payment.id,
      paymentId: payment.id,
      date: payment.paymentDate,
      description: `Payment for ${purchase.purchaseNumber}`,
      lines,
    });
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
        creditLines: {
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

      const debitBalance = totalDebit + (account.type === 'ASSET' || account.type === 'EXPENSE' ? openingBalance : 0);
      const creditBalance = totalCredit + (account.type === 'LIABILITY' || account.type === 'EQUITY' || account.type === 'REVENUE' ? openingBalance : 0);

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
  async getProfitAndLoss(organizationId: string, from: Date, to: Date) {
    const [revenue, expenses, cogs] = await Promise.all([
      this.getAccountTotals(organizationId, 'REVENUE', from, to),
      this.getAccountTotals(organizationId, 'EXPENSE', from, to),
      this.getAccountTotals(organizationId, 'EXPENSE', from, to, 'COST_OF_GOODS_SOLD'),
    ]);

    const grossProfit = revenue.total - cogs.total;
    const operatingExpenses = expenses.total - cogs.total;
    const netProfit = grossProfit - operatingExpenses;

    return {
      revenue,
      cogs,
      grossProfit,
      operatingExpenses: expenses,
      netProfit,
      grossMargin: revenue.total > 0 ? roundTo((grossProfit / revenue.total) * 100) : 0,
      netMargin: revenue.total > 0 ? roundTo((netProfit / revenue.total) * 100) : 0,
    };
  }

  // ─── Get Balance Sheet ────────────────────────────────────────────────────────
  async getBalanceSheet(organizationId: string, asOfDate: Date) {
    const [assets, liabilities, equity] = await Promise.all([
      this.getAccountTotals(organizationId, 'ASSET', new Date(0), asOfDate),
      this.getAccountTotals(organizationId, 'LIABILITY', new Date(0), asOfDate),
      this.getAccountTotals(organizationId, 'EQUITY', new Date(0), asOfDate),
    ]);

    return { assets, liabilities, equity };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────
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
    lines: Array<{ accountId: string; debitAmount: number; creditAmount: number; description: string }>;
  }) {
    const totalDebit = data.lines.reduce((sum, l) => sum + l.debitAmount, 0);
    const totalCredit = data.lines.reduce((sum, l) => sum + l.creditAmount, 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error(`Journal entry is not balanced: debit=${totalDebit}, credit=${totalCredit}`);
    }

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
        date: data.date,
        description: data.description,
        totalDebit: roundTo(totalDebit),
        totalCredit: roundTo(totalCredit),
        isPosted: true,
        postedAt: new Date(),
        lines: {
          create: data.lines.map((line, idx) => ({
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

    const map: Record<string, string> = {};
    for (const acc of accounts) {
      if (acc.subType) {
        map[acc.subType] = acc.id;
      }
      // Map by code for specific accounts
      if (acc.code === '4000') map['SALES_REVENUE'] = acc.id;
      if (acc.code === '1000') map['CASH'] = acc.id;
      if (acc.code === '5100') map['PURCHASES'] = acc.id;
      if (acc.code === '2200') map['CGST_PAYABLE'] = acc.id;
      if (acc.code === '2300') map['SGST_PAYABLE'] = acc.id;
      if (acc.code === '2400') map['IGST_PAYABLE'] = acc.id;
    }

    this.systemAccounts[organizationId] = map;
    return map;
  }

  private async getBankAccountId(bankAccountId: string): Promise<string> {
    const bankAccount = await prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
      select: { accountId: true },
    });
    return bankAccount?.accountId || bankAccountId;
  }

  private async getAccountTotals(
    organizationId: string,
    type: string,
    from: Date,
    to: Date,
    subType?: string
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
    });

    const breakdown = accounts.map(acc => {
      const totalDebit = acc.debitLines.reduce((s, l) => s + toDecimal(l.debitAmount), 0);
      const totalCredit = acc.debitLines.reduce((s, l) => s + toDecimal(l.creditAmount), 0);
      const balance = type === 'ASSET' || type === 'EXPENSE'
        ? totalDebit - totalCredit
        : totalCredit - totalDebit;

      return { accountId: acc.id, code: acc.code, name: acc.name, balance: roundTo(balance) };
    });

    return {
      breakdown,
      total: roundTo(breakdown.reduce((s, a) => s + a.balance, 0)),
    };
  }
}
