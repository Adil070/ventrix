import { prisma } from '../../infrastructure/database';
import { toDecimal, roundTo } from '../../shared/helpers/response.helper';

/**
 * GST Engine - Indian GST Compliance
 * Handles GSTR-1, GSTR-2, GSTR-3B, reconciliation
 */
type TaxSplit = { taxableValue: number; cgst: number; sgst: number; igst: number; total: number };
const zeroSplit = (): TaxSplit => ({ taxableValue: 0, cgst: 0, sgst: 0, igst: 0, total: 0 });

/**
 * GST given back through credit notes (sales returns: output tax reduced) and debit notes (purchase returns:
 * input credit reduced) dated in the period, read from their ledger entries. A note cancelled in the period
 * is netted off through its reversal entry.
 */
export async function noteTaxAdjustments(organizationId: string, from: Date, to: Date) {
  const noteEntries = await prisma.journalEntry.findMany({
    where: { organizationId, isPosted: true, type: { in: ['CREDIT_NOTE', 'DEBIT_NOTE'] } },
    select: { id: true, type: true, date: true },
  });
  const noteType = new Map(noteEntries.map(e => [e.id, e.type]));
  const inPeriod = (d: Date) => d >= from && d <= to;
  const reversals = noteEntries.length
    ? await prisma.journalEntry.findMany({
        where: { organizationId, isPosted: true, referenceType: 'REVERSAL', referenceId: { in: [...noteType.keys()] }, date: { gte: from, lte: to } },
        select: { id: true, referenceId: true },
      })
    : [];
  const entryType = new Map<string, string>();
  for (const e of noteEntries) if (inPeriod(e.date)) entryType.set(e.id, e.type);
  for (const r of reversals) entryType.set(r.id, noteType.get(r.referenceId!)!);
  if (!entryType.size) return { creditNotes: zeroSplit(), debitNotes: zeroSplit() };

  const lines = await prisma.journalEntryLine.findMany({
    where: { journalEntryId: { in: [...entryType.keys()] }, account: { code: { in: ['2200', '2300', '2400', '4000', '5100'] } } },
    select: { journalEntryId: true, debitAmount: true, creditAmount: true, account: { select: { code: true } } },
  });
  const creditNotes = zeroSplit(), debitNotes = zeroSplit();
  const field: Record<string, keyof TaxSplit> = { '2200': 'cgst', '2300': 'sgst', '2400': 'igst', '4000': 'taxableValue', '5100': 'taxableValue' };
  for (const l of lines) {
    const isCredit = entryType.get(l.journalEntryId) === 'CREDIT_NOTE';
    // Credit notes debit Sales/GST; debit notes credit Purchases/GST. Reversals carry the opposite sign and net off.
    const amount = isCredit ? toDecimal(l.debitAmount) - toDecimal(l.creditAmount) : toDecimal(l.creditAmount) - toDecimal(l.debitAmount);
    const target = isCredit ? creditNotes : debitNotes;
    const key = field[l.account.code];
    if ((isCredit && l.account.code === '5100') || (!isCredit && l.account.code === '4000')) continue;
    target[key] = roundTo(target[key] + amount);
  }
  for (const t of [creditNotes, debitNotes]) t.total = roundTo(t.cgst + t.sgst + t.igst);
  return { creditNotes, debitNotes };
}

export class GSTEngine {
  // ─── Validate GSTIN ───────────────────────────────────────────────────────────
  validateGSTIN(gstin: string): { valid: boolean; stateCode?: string; entityType?: string } {
    // GSTIN format: 2 digit state code + 10 digit PAN + 1 entity number + 1 Z + 1 checksum
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

    if (!gstinRegex.test(gstin)) {
      return { valid: false };
    }

    const stateCodes: Record<string, string> = {
      '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
      '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
      '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
      '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
      '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
      '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
      '24': 'Gujarat', '25': 'Daman & Diu', '26': 'Dadra & Nagar Haveli',
      '27': 'Maharashtra', '28': 'Andhra Pradesh (Old)', '29': 'Karnataka',
      '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
      '34': 'Puducherry', '35': 'Andaman & Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh',
    };

    const stateCode = gstin.substring(0, 2);
    return {
      valid: true,
      stateCode: stateCodes[stateCode] || 'Unknown',
      entityType: this.getEntityType(gstin.charAt(12)),
    };
  }

  private getEntityType(code: string): string {
    const types: Record<string, string> = {
      '1': 'Individual/Proprietor', '2': 'Partnership', '3': 'HUF',
      '4': 'Company', '5': 'AOP/BOI', '6': 'Trust', '7': 'AOP',
      '8': 'Government', '9': 'Public Sector', 'A': 'AOP', 'B': 'Local Authority',
      'C': 'Statutory Body', 'D': 'OIDAR', 'E': 'EOU', 'F': 'SEZ Developer',
      'G': 'Government Entity', 'H': 'Diplomatic Mission',
    };
    return types[code] || 'Other';
  }

  // ─── Get GST Tax Breakup ──────────────────────────────────────────────────────
  calculateGST(
    taxableAmount: number,
    gstRate: number,
    isInterState: boolean
  ): { cgst: number; sgst: number; igst: number; total: number } {
    const halfRate = gstRate / 2;

    if (isInterState) {
      const igst = roundTo((taxableAmount * gstRate) / 100);
      return { cgst: 0, sgst: 0, igst, total: igst };
    } else {
      const cgst = roundTo((taxableAmount * halfRate) / 100);
      const sgst = roundTo((taxableAmount * halfRate) / 100);
      return { cgst, sgst, igst: 0, total: cgst + sgst };
    }
  }

  // ─── GSTR-1 Report ────────────────────────────────────────────────────────────
  async generateGSTR1(organizationId: string, month: number, year: number) {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59);

    const invoices = await prisma.invoice.findMany({
      where: {
        organizationId,
        status: { notIn: ['DRAFT', 'CANCELLED'] },
        invoiceDate: { gte: from, lte: to },
      },
      include: {
        customer: { select: { name: true, gstin: true, billingAddress: true } },
        items: true,
      },
    });

    // Categorize invoices
    const b2b: any[] = []; // B2B supplies (registered dealers)
    const b2c: any[] = []; // B2C supplies (unregistered)
    const b2cLarge: any[] = []; // B2C large (>2.5L interstate)
    const exports: any[] = [];
    const creditNotes: any[] = [];
    const nilRated: any[] = [];
    const hsn: Record<string, any> = {};

    for (const invoice of invoices) {
      const isB2B = !!invoice.customer?.gstin;
      const isExport = invoice.isExport;
      const summary = {
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        gstin: invoice.customer?.gstin,
        customerName: invoice.customer?.name,
        taxableValue: toDecimal(invoice.taxableAmount),
        cgst: toDecimal(invoice.cgstAmount),
        sgst: toDecimal(invoice.sgstAmount),
        igst: toDecimal(invoice.igstAmount),
        totalTax: toDecimal(invoice.taxAmount),
        invoiceValue: toDecimal(invoice.totalAmount),
        placeOfSupply: invoice.placeOfSupply,
        reverseCharge: invoice.reverseCharge,
      };

      if (isExport) {
        exports.push(summary);
      } else if (isB2B) {
        b2b.push(summary);
      } else {
        b2c.push(summary);
      }

      // HSN Summary
      for (const item of invoice.items) {
        const key = item.hsnCode || 'UNKNOWN';
        if (!hsn[key]) {
          hsn[key] = { hsnCode: key, description: item.description, uqc: 'NOS', quantity: 0, totalValue: 0, taxableValue: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
        }
        hsn[key].quantity += toDecimal(item.quantity);
        hsn[key].totalValue += toDecimal(item.amount);
        hsn[key].taxableValue += toDecimal(item.taxableAmount);
        hsn[key].igst += toDecimal(item.igstAmount);
        hsn[key].cgst += toDecimal(item.cgstAmount);
        hsn[key].sgst += toDecimal(item.sgstAmount);
      }
    }

    const totals = {
      taxableValue: invoices.reduce((sum, i) => sum + toDecimal(i.taxableAmount), 0),
      cgst: invoices.reduce((sum, i) => sum + toDecimal(i.cgstAmount), 0),
      sgst: invoices.reduce((sum, i) => sum + toDecimal(i.sgstAmount), 0),
      igst: invoices.reduce((sum, i) => sum + toDecimal(i.igstAmount), 0),
      totalTax: invoices.reduce((sum, i) => sum + toDecimal(i.taxAmount), 0),
      invoiceValue: invoices.reduce((sum, i) => sum + toDecimal(i.totalAmount), 0),
    };

    return {
      period: `${month}/${year}`,
      gstin: (await prisma.organization.findUnique({ where: { id: organizationId }, select: { gstin: true } }))?.gstin,
      b2b,
      b2c,
      b2cLarge,
      exports,
      creditNotes,
      nilRated,
      hsnSummary: Object.values(hsn),
      totals,
      invoiceCount: invoices.length,
    };
  }

  // ─── GSTR-3B Summary ──────────────────────────────────────────────────────────
  async generateGSTR3B(organizationId: string, month: number, year: number) {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59);

    const [salesData, purchaseData] = await Promise.all([
      prisma.invoice.aggregate({
        where: {
          organizationId,
          status: { notIn: ['DRAFT', 'CANCELLED'] },
          invoiceDate: { gte: from, lte: to },
        },
        _sum: { taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true, taxAmount: true },
      }),
      prisma.purchase.aggregate({
        where: {
          organizationId,
          status: { notIn: ['DRAFT', 'CANCELLED'] },
          purchaseDate: { gte: from, lte: to },
        },
        _sum: { taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true, taxAmount: true },
      }),
    ]);

    // Returns in the period reduce the tax: credit notes cut output tax, debit notes cut input credit.
    const { creditNotes, debitNotes } = await noteTaxAdjustments(organizationId, from, to);

    const outputTax = {
      taxableValue: roundTo(toDecimal(salesData._sum.taxableAmount) - creditNotes.taxableValue),
      cgst: roundTo(toDecimal(salesData._sum.cgstAmount) - creditNotes.cgst),
      sgst: roundTo(toDecimal(salesData._sum.sgstAmount) - creditNotes.sgst),
      igst: roundTo(toDecimal(salesData._sum.igstAmount) - creditNotes.igst),
      total: roundTo(toDecimal(salesData._sum.taxAmount) - creditNotes.total),
    };

    const inputTaxCredit = {
      cgst: roundTo(toDecimal(purchaseData._sum.cgstAmount) - debitNotes.cgst),
      sgst: roundTo(toDecimal(purchaseData._sum.sgstAmount) - debitNotes.sgst),
      igst: roundTo(toDecimal(purchaseData._sum.igstAmount) - debitNotes.igst),
      total: roundTo(toDecimal(purchaseData._sum.taxAmount) - debitNotes.total),
    };

    const netGSTLiability = {
      cgst: roundTo(outputTax.cgst - inputTaxCredit.cgst),
      sgst: roundTo(outputTax.sgst - inputTaxCredit.sgst),
      igst: roundTo(outputTax.igst - inputTaxCredit.igst),
      total: roundTo(outputTax.total - inputTaxCredit.total),
    };

    return {
      period: `${month}/${year}`,
      outwardSupplies: outputTax,
      inwardSupplies: inputTaxCredit,
      netGSTLiability,
      creditNotes,
      debitNotes,
      dueDate: new Date(year, month, 20), // 20th of next month
    };
  }

  // ─── GST Reconciliation ───────────────────────────────────────────────────────
  async reconcileGST(organizationId: string, month: number, year: number) {
    const gstr1 = await this.generateGSTR1(organizationId, month, year);
    const gstr3b = await this.generateGSTR3B(organizationId, month, year);

    const differences = {
      taxableValue: roundTo(gstr1.totals.taxableValue - gstr3b.outwardSupplies.taxableValue),
      cgst: roundTo(gstr1.totals.cgst - gstr3b.outwardSupplies.cgst),
      sgst: roundTo(gstr1.totals.sgst - gstr3b.outwardSupplies.sgst),
      igst: roundTo(gstr1.totals.igst - gstr3b.outwardSupplies.igst),
    };

    return {
      gstr1Summary: gstr1.totals,
      gstr3bSummary: gstr3b.outwardSupplies,
      differences,
      isReconciled: Object.values(differences).every(d => Math.abs(d) < 0.01),
    };
  }

  // ─── Get HSN Summary ──────────────────────────────────────────────────────────
  async getHSNSummary(organizationId: string, from: Date, to: Date) {
    const items = await prisma.invoiceItem.findMany({
      where: {
        invoice: {
          organizationId,
          status: { notIn: ['DRAFT', 'CANCELLED'] },
          invoiceDate: { gte: from, lte: to },
        },
        hsnCode: { not: null },
      },
    });

    const hsnMap: Record<string, any> = {};

    for (const item of items) {
      const key = item.hsnCode!;
      if (!hsnMap[key]) {
        hsnMap[key] = {
          hsnCode: key,
          description: item.description,
          totalQuantity: 0,
          taxableValue: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
        };
      }
      hsnMap[key].totalQuantity += toDecimal(item.quantity);
      hsnMap[key].taxableValue += toDecimal(item.taxableAmount);
      hsnMap[key].cgst += toDecimal(item.cgstAmount);
      hsnMap[key].sgst += toDecimal(item.sgstAmount);
      hsnMap[key].igst += toDecimal(item.igstAmount);
    }

    return Object.values(hsnMap).map(h => ({
      ...h,
      totalTax: roundTo(h.cgst + h.sgst + h.igst),
      taxableValue: roundTo(h.taxableValue),
    }));
  }
}

export const gstEngine = new GSTEngine();
