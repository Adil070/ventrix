import { prisma } from '../../infrastructure/database';
import { toDecimal, roundTo } from '../../shared/helpers/response.helper';

/**
 * GST Engine - Indian GST Compliance
 * Handles GSTR-1, GSTR-2, GSTR-3B, reconciliation
 */
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
        status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] },
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
          status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] },
          invoiceDate: { gte: from, lte: to },
        },
        _sum: { taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true, taxAmount: true },
      }),
      prisma.purchase.aggregate({
        where: {
          organizationId,
          status: { notIn: ['CANCELLED'] },
          purchaseDate: { gte: from, lte: to },
        },
        _sum: { taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true, taxAmount: true },
      }),
    ]);

    const outputTax = {
      taxableValue: toDecimal(salesData._sum.taxableAmount),
      cgst: toDecimal(salesData._sum.cgstAmount),
      sgst: toDecimal(salesData._sum.sgstAmount),
      igst: toDecimal(salesData._sum.igstAmount),
      total: toDecimal(salesData._sum.taxAmount),
    };

    const inputTaxCredit = {
      cgst: toDecimal(purchaseData._sum.cgstAmount),
      sgst: toDecimal(purchaseData._sum.sgstAmount),
      igst: toDecimal(purchaseData._sum.igstAmount),
      total: toDecimal(purchaseData._sum.taxAmount),
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
          status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] },
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
