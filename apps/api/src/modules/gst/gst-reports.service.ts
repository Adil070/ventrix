import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { toDecimal, roundTo } from '@/shared/helpers/response.helper';

export class GSTReportsService {
  
  /**
   * GSTR-1 Report - Outward Supplies
   * All sales invoices with GST breakup
   */
  async generateGSTR1(organizationId: string, fromDate: Date, toDate: Date) {
    // Get organization GSTIN
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { gstin: true, state: true }
    });

    // Get all confirmed invoices in the period
    const invoices = await prisma.invoice.findMany({
      where: {
        organizationId,
        status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] },
        invoiceDate: { gte: fromDate, lte: toDate }
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            gstin: true,
            state: true,
            email: true,
            phone: true
          }
        },
        items: {
          include: {
            product: {
              select: { hsnCode: true, sacCode: true }
            }
          }
        }
      },
      orderBy: { invoiceDate: 'asc' }
    });

    // Classify invoices
    const b2b: any[] = []; // B2B - Business to Business (GSTIN available)
    const b2cl: any[] = []; // B2CL - B2C Large (invoice > 2.5 lakh, no GSTIN)
    const b2cs: any[] = []; // B2CS - B2C Small (invoice <= 2.5 lakh, no GSTIN)
    const exports: any[] = []; // Export invoices
    
    for (const invoice of invoices) {
      const invoiceTotal = toDecimal(invoice.totalAmount);
      const taxableValue = toDecimal(invoice.taxableAmount);
      const cgstAmount = toDecimal(invoice.cgstAmount);
      const sgstAmount = toDecimal(invoice.sgstAmount);
      const igstAmount = toDecimal(invoice.igstAmount);

      const invoiceData = {
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        invoiceValue: invoiceTotal,
        placeOfSupply: invoice.placeOfSupply || org?.state,
        reverseCharge: invoice.reverseCharge ? 'Y' : 'N',
        invoiceType: invoice.invoiceType,
        taxableValue,
        cgstAmount,
        sgstAmount,
        igstAmount,
        cessAmount: 0, // Add if you track cess
        items: invoice.items.map(item => ({
          description: item.description,
          hsnCode: item.hsnCode || item.product?.hsnCode,
          sacCode: item.sacCode || item.product?.sacCode,
          quantity: toDecimal(item.quantity),
          unitPrice: toDecimal(item.unitPrice),
          taxableAmount: toDecimal(item.taxableAmount),
          cgstRate: toDecimal(item.cgstRate),
          sgstRate: toDecimal(item.sgstRate),
          igstRate: toDecimal(item.igstRate),
          cgstAmount: toDecimal(item.cgstAmount),
          sgstAmount: toDecimal(item.sgstAmount),
          igstAmount: toDecimal(item.igstAmount)
        }))
      };

      // Check if export
      if (invoice.isExport) {
        exports.push({
          ...invoiceData,
          exportType: invoice.exportType,
          shippingBillNumber: null, // Add field if you track this
          shippingBillDate: null,
          portCode: null
        });
      }
      // B2B - Customer has GSTIN
      else if (invoice.customer?.gstin) {
        b2b.push({
          ...invoiceData,
          customerGSTIN: invoice.customer.gstin,
          customerName: invoice.customer.name,
          customerState: invoice.customer.state
        });
      }
      // B2CL - Large B2C invoice (> 2.5 lakh)
      else if (invoiceTotal > 250000) {
        b2cl.push({
          ...invoiceData,
          customerName: invoice.customer?.name || 'Walk-in Customer',
          customerState: invoice.customer?.state || invoice.placeOfSupply
        });
      }
      // B2CS - Small B2C invoice
      else {
        b2cs.push({
          ...invoiceData,
          customerState: invoice.customer?.state || invoice.placeOfSupply
        });
      }
    }

    // Aggregate B2CS by state and rate
    const b2csAggregated = this.aggregateB2CS(b2cs);

    // HSN Summary
    const hsnSummary = await this.generateHSNSummary(organizationId, fromDate, toDate, 'OUTWARD');

    // Calculate totals
    const totals = {
      totalInvoices: invoices.length,
      totalTaxableValue: invoices.reduce((sum: number, inv: any) => sum + toDecimal(inv.taxableAmount), 0),
      totalCGST: invoices.reduce((sum: number, inv: any) => sum + toDecimal(inv.cgstAmount), 0),
      totalSGST: invoices.reduce((sum: number, inv: any) => sum + toDecimal(inv.sgstAmount), 0),
      totalIGST: invoices.reduce((sum: number, inv: any) => sum + toDecimal(inv.igstAmount), 0),
      totalTax: invoices.reduce((sum: number, inv: any) => sum + toDecimal(inv.taxAmount), 0),
      totalInvoiceValue: invoices.reduce((sum: number, inv: any) => sum + toDecimal(inv.totalAmount), 0)
    };

    return {
      gstin: org?.gstin,
      period: { from: fromDate, to: toDate },
      b2b,
      b2cl,
      b2cs: b2csAggregated,
      exports,
      hsnSummary,
      totals,
      summary: {
        b2bCount: b2b.length,
        b2clCount: b2cl.length,
        b2csCount: b2cs.length,
        exportsCount: exports.length
      }
    };
  }

  /**
   * GSTR-2 Report - Inward Supplies
   * All purchase invoices with GST breakup
   */
  async generateGSTR2(organizationId: string, fromDate: Date, toDate: Date) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { gstin: true, state: true }
    });

    const purchases = await prisma.purchase.findMany({
      where: {
        organizationId,
        status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] },
        purchaseDate: { gte: fromDate, lte: toDate }
      },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            gstin: true,
            state: true
          }
        },
        items: {
          include: {
            product: {
              select: { hsnCode: true, sacCode: true }
            }
          }
        }
      },
      orderBy: { purchaseDate: 'asc' }
    });

    const b2b: any[] = [];
    const imports: any[] = [];

    for (const purchase of purchases) {
      const purchaseData = {
        invoiceNumber: purchase.billNumber,
        invoiceDate: purchase.purchaseDate,
        invoiceValue: toDecimal(purchase.totalAmount),
        placeOfSupply: purchase.placeOfSupply || org?.state,
        reverseCharge: purchase.reverseCharge ? 'Y' : 'N',
        taxableValue: toDecimal(purchase.taxableAmount),
        cgstAmount: toDecimal(purchase.cgstAmount),
        sgstAmount: toDecimal(purchase.sgstAmount),
        igstAmount: toDecimal(purchase.igstAmount),
        supplierGSTIN: purchase.supplier?.gstin,
        supplierName: purchase.supplier?.name,
        supplierState: purchase.supplier?.state,
        items: purchase.items.map(item => ({
          description: item.description,
          hsnCode: item.hsnCode || item.product?.hsnCode,
          quantity: toDecimal(item.quantity),
          unitPrice: toDecimal(item.unitPrice),
          taxableAmount: toDecimal(item.taxableAmount),
          cgstRate: toDecimal(item.cgstRate),
          sgstRate: toDecimal(item.sgstRate),
          igstRate: toDecimal(item.igstRate),
          cgstAmount: toDecimal(item.cgstAmount),
          sgstAmount: toDecimal(item.sgstAmount),
          igstAmount: toDecimal(item.igstAmount)
        }))
      };

      // Check if import (add isImport field if needed)
      if (purchase.supplier?.gstin === null || purchase.supplier?.gstin === '') {
        imports.push(purchaseData);
      } else {
        b2b.push(purchaseData);
      }
    }

    const hsnSummary = await this.generateHSNSummary(organizationId, fromDate, toDate, 'INWARD');

    const totals = {
      totalPurchases: purchases.length,
      totalTaxableValue: purchases.reduce((sum: number, p: any) => sum + toDecimal(p.taxableAmount), 0),
      totalCGST: purchases.reduce((sum: number, p: any) => sum + toDecimal(p.cgstAmount), 0),
      totalSGST: purchases.reduce((sum: number, p: any) => sum + toDecimal(p.sgstAmount), 0),
      totalIGST: purchases.reduce((sum: number, p: any) => sum + toDecimal(p.igstAmount), 0),
      totalTax: purchases.reduce((sum: number, p: any) => sum + toDecimal(p.taxAmount), 0),
      totalPurchaseValue: purchases.reduce((sum: number, p: any) => sum + toDecimal(p.totalAmount), 0)
    };

    return {
      gstin: org?.gstin,
      period: { from: fromDate, to: toDate },
      b2b,
      imports,
      hsnSummary,
      totals
    };
  }

  /**
   * GSTR-3B Report - Monthly Summary Return
   */
  async generateGSTR3B(organizationId: string, month: number, year: number) {
    const fromDate = new Date(year, month - 1, 1);
    const toDate = new Date(year, month, 0); // Last day of month

    // Outward supplies (Sales)
    const salesTotals = await prisma.invoice.aggregate({
      where: {
        organizationId,
        status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] },
        invoiceDate: { gte: fromDate, lte: toDate }
      },
      _sum: {
        taxableAmount: true,
        cgstAmount: true,
        sgstAmount: true,
        igstAmount: true,
        totalAmount: true
      },
      _count: true
    });

    // Inward supplies (Purchases) - ITC
    const purchaseTotals = await prisma.purchase.aggregate({
      where: {
        organizationId,
        status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] },
        purchaseDate: { gte: fromDate, lte: toDate }
      },
      _sum: {
        taxableAmount: true,
        cgstAmount: true,
        sgstAmount: true,
        igstAmount: true
      },
      _count: true
    });

    const outputTax = {
      taxableValue: toDecimal(salesTotals._sum.taxableAmount),
      cgst: toDecimal(salesTotals._sum.cgstAmount),
      sgst: toDecimal(salesTotals._sum.sgstAmount),
      igst: toDecimal(salesTotals._sum.igstAmount),
      cess: 0
    };

    const inputTax = {
      taxableValue: toDecimal(purchaseTotals._sum.taxableAmount),
      cgst: toDecimal(purchaseTotals._sum.cgstAmount),
      sgst: toDecimal(purchaseTotals._sum.sgstAmount),
      igst: toDecimal(purchaseTotals._sum.igstAmount),
      cess: 0
    };

    const netTax = {
      cgst: roundTo(outputTax.cgst - inputTax.cgst),
      sgst: roundTo(outputTax.sgst - inputTax.sgst),
      igst: roundTo(outputTax.igst - inputTax.igst),
      cess: 0
    };

    const totalTaxPayable = roundTo(netTax.cgst + netTax.sgst + netTax.igst + netTax.cess);

    return {
      month,
      year,
      period: { from: fromDate, to: toDate },
      outwardSupplies: {
        totalInvoices: salesTotals._count,
        ...outputTax,
        totalTax: roundTo(outputTax.cgst + outputTax.sgst + outputTax.igst)
      },
      inwardSupplies: {
        totalBills: purchaseTotals._count,
        ...inputTax,
        totalITC: roundTo(inputTax.cgst + inputTax.sgst + inputTax.igst)
      },
      netTaxLiability: {
        ...netTax,
        total: totalTaxPayable
      },
      interestLateFee: {
        interest: 0,
        lateFee: 0
      },
      totalPayable: totalTaxPayable
    };
  }

  /**
   * HSN Summary (for GSTR-1 and GSTR-2)
   */
  private async generateHSNSummary(
    organizationId: string, 
    fromDate: Date, 
    toDate: Date,
    type: 'OUTWARD' | 'INWARD'
  ) {
    let items: any[];

    if (type === 'OUTWARD') {
      items = await prisma.invoiceItem.findMany({
        where: {
          invoice: {
            organizationId,
            status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] },
            invoiceDate: { gte: fromDate, lte: toDate }
          }
        },
        include: {
          product: { select: { hsnCode: true, sacCode: true } }
        }
      });
    } else {
      items = await prisma.purchaseItem.findMany({
        where: {
          purchase: {
            organizationId,
            status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] },
            purchaseDate: { gte: fromDate, lte: toDate }
          }
        },
        include: {
          product: { select: { hsnCode: true, sacCode: true } }
        }
      });
    }

    // Group by HSN/SAC code
    const hsnMap = new Map<string, any>();

    for (const item of items) {
      const code = item.hsnCode || item.product?.hsnCode || item.product?.sacCode || 'UNCLASSIFIED';
      const taxRate = toDecimal(item.cgstRate) + toDecimal(item.sgstRate) + toDecimal(item.igstRate);

      if (!hsnMap.has(code)) {
        hsnMap.set(code, {
          hsnCode: code,
          description: item.description,
          uqc: item.unit || 'NOS',
          totalQuantity: 0,
          totalValue: 0,
          taxableValue: 0,
          cgstAmount: 0,
          sgstAmount: 0,
          igstAmount: 0,
          taxRate
        });
      }

      const entry = hsnMap.get(code);
      entry.totalQuantity += toDecimal(item.quantity);
      entry.totalValue += toDecimal(item.amount);
      entry.taxableValue += toDecimal(item.taxableAmount);
      entry.cgstAmount += toDecimal(item.cgstAmount);
      entry.sgstAmount += toDecimal(item.sgstAmount);
      entry.igstAmount += toDecimal(item.igstAmount);
    }

    return Array.from(hsnMap.values()).map(entry => ({
      ...entry,
      totalQuantity: roundTo(entry.totalQuantity, 2),
      totalValue: roundTo(entry.totalValue, 2),
      taxableValue: roundTo(entry.taxableValue, 2),
      cgstAmount: roundTo(entry.cgstAmount, 2),
      sgstAmount: roundTo(entry.sgstAmount, 2),
      igstAmount: roundTo(entry.igstAmount, 2),
      totalTax: roundTo(entry.cgstAmount + entry.sgstAmount + entry.igstAmount, 2)
    }));
  }

  /**
   * Aggregate B2CS entries by state and tax rate
   */
  private aggregateB2CS(b2csEntries: any[]) {
    const aggregated = new Map<string, any>();

    for (const entry of b2csEntries) {
      const key = `${entry.customerState}_${entry.taxableValue}`;
      
      if (!aggregated.has(key)) {
        aggregated.set(key, {
          state: entry.customerState,
          supplyType: entry.cgstAmount > 0 ? 'Intra-State' : 'Inter-State',
          taxRate: 0,
          taxableValue: 0,
          cgstAmount: 0,
          sgstAmount: 0,
          igstAmount: 0,
          cessAmount: 0
        });
      }

      const agg = aggregated.get(key);
      agg.taxableValue += entry.taxableValue;
      agg.cgstAmount += entry.cgstAmount;
      agg.sgstAmount += entry.sgstAmount;
      agg.igstAmount += entry.igstAmount;
    }

    return Array.from(aggregated.values());
  }
}
