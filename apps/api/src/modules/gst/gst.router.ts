import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { GSTEngine } from './gst.engine';

const gstEngine = new GSTEngine();
const router = Router();
router.use(authMiddleware, tenantMiddleware);

// ─── HSN/SAC Codes ────────────────────────────────────────────────────────────
router.get('/hsn', async (req: Request, res: Response) => {
  const { search } = req.query as any;
  const codes = await prisma.hSNCode.findMany({
    where: {
      organizationId: req.organizationId!,
      ...(search && { OR: [{ code: { contains: search } }, { description: { contains: search, mode: 'insensitive' } }] }),
    },
    take: 50,
  });
  res.json(successResponse(codes));
});

router.post('/hsn', async (req: Request, res: Response) => {
  const { code, description, taxRate } = req.body;
  const hsn = await prisma.hSNCode.create({ data: { organizationId: req.organizationId!, code, description, gstRate: taxRate } });
  res.status(201).json(successResponse(hsn));
});

// ─── GSTIN Validation ──────────────────────────────────────────────────────────
router.post('/validate-gstin', async (req: Request, res: Response) => {
  const { gstin } = req.body;
  const result = gstEngine.validateGSTIN(gstin);
  res.json(successResponse(result));
});

// ─── GST Reports ──────────────────────────────────────────────────────────────
router.get('/reports/gstr1', async (req: Request, res: Response) => {
  const { month, year } = req.query as any;
  const result = await gstEngine.generateGSTR1(req.organizationId!, +month, +year);
  res.json(successResponse(result));
});
router.get('/gstr1', async (req: Request, res: Response) => {
  const { month, year } = req.query as any;
  const result = await gstEngine.generateGSTR1(req.organizationId!, +month, +year);
  res.json(successResponse(result));
});

router.get('/reports/gstr2', async (req: Request, res: Response) => {
  const { month, year } = req.query as any;
  // GSTR-2 (purchase register) - compute inline
  const from = new Date(+year, +month - 1, 1);
  const to = new Date(+year, +month, 0, 23, 59, 59);
  const purchases = await prisma.purchase.findMany({
    where: { organizationId: req.organizationId!, purchaseDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
    include: { supplier: { select: { name: true, gstin: true } }, items: true },
  });
  res.json(successResponse({ month: +month, year: +year, purchases }));
});

router.get('/reports/gstr3b', async (req: Request, res: Response) => {
  const { month, year } = req.query as any;
  const result = await gstEngine.generateGSTR3B(req.organizationId!, +month, +year);
  res.json(successResponse(result));
});
router.get('/gstr3b', async (req: Request, res: Response) => {
  const { month, year } = req.query as any;
  const result = await gstEngine.generateGSTR3B(req.organizationId!, +month, +year);
  res.json(successResponse(result));
});

router.get('/reports/gst-summary', async (req: Request, res: Response) => {
  const { fromDate, toDate, startDate, endDate } = req.query as any;
  const from = (fromDate || startDate) ? new Date(fromDate || startDate) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const to = (toDate || endDate) ? new Date(toDate || endDate) : new Date();

  const [salesGST, purchaseGST] = await Promise.all([
    prisma.invoice.aggregate({
      where: { organizationId: req.organizationId!, invoiceDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
      _sum: { cgstAmount: true, sgstAmount: true, igstAmount: true, taxAmount: true, taxableAmount: true, totalAmount: true },
    }),
    prisma.purchase.aggregate({
      where: { organizationId: req.organizationId!, purchaseDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
      _sum: { cgstAmount: true, sgstAmount: true, igstAmount: true, taxAmount: true, taxableAmount: true, totalAmount: true },
    }),
  ]);

  const outputGST = Number(salesGST._sum.taxAmount || 0);
  const inputGST = Number(purchaseGST._sum.taxAmount || 0);

  res.json(successResponse({
    outputTax: { cgst: salesGST._sum.cgstAmount, sgst: salesGST._sum.sgstAmount, igst: salesGST._sum.igstAmount, total: outputGST },
    inputTax: { cgst: purchaseGST._sum.cgstAmount, sgst: purchaseGST._sum.sgstAmount, igst: purchaseGST._sum.igstAmount, total: inputGST },
    netGSTPayable: outputGST - inputGST,
    taxableAmount: salesGST._sum.taxableAmount,
    totalSales: salesGST._sum.totalAmount,
    totalPurchases: purchaseGST._sum.totalAmount,
  }));
});

// ─── Tax Rates ────────────────────────────────────────────────────────────────
router.get('/summary', async (req: Request, res: Response) => {
  const { fromDate, toDate, startDate, endDate } = req.query as any;
  const from = (fromDate || startDate) ? new Date(fromDate || startDate) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const to = (toDate || endDate) ? new Date(toDate || endDate) : new Date();

  const [salesGST, purchaseGST] = await Promise.all([
    prisma.invoice.aggregate({
      where: { organizationId: req.organizationId!, invoiceDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
      _sum: { cgstAmount: true, sgstAmount: true, igstAmount: true, taxAmount: true, taxableAmount: true, totalAmount: true },
    }),
    prisma.purchase.aggregate({
      where: { organizationId: req.organizationId!, purchaseDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
      _sum: { cgstAmount: true, sgstAmount: true, igstAmount: true, taxAmount: true, taxableAmount: true, totalAmount: true },
    }),
  ]);

  const outputGST = Number(salesGST._sum.taxAmount || 0);
  const inputGST = Number(purchaseGST._sum.taxAmount || 0);

  res.json(successResponse({
    outputTax: { cgst: salesGST._sum.cgstAmount, sgst: salesGST._sum.sgstAmount, igst: salesGST._sum.igstAmount, total: outputGST },
    inputTax: { cgst: purchaseGST._sum.cgstAmount, sgst: purchaseGST._sum.sgstAmount, igst: purchaseGST._sum.igstAmount, total: inputGST },
    netGSTPayable: outputGST - inputGST,
    taxableAmount: salesGST._sum.taxableAmount,
    totalSales: salesGST._sum.totalAmount,
    totalPurchases: purchaseGST._sum.totalAmount,
  }));
});

router.get('/tax-rates', async (req: Request, res: Response) => {
  const taxRates = await prisma.taxRate.findMany({
    where: { organizationId: req.organizationId!, isActive: true },
    orderBy: { rate: 'asc' },
  });
  res.json(successResponse(taxRates));
});

router.post('/tax-rates', async (req: Request, res: Response) => {
  const { name, rate, description } = req.body;
  const taxRate = await prisma.taxRate.create({ data: { organizationId: req.organizationId!, name, rate } });
  res.status(201).json(successResponse(taxRate));
});

export { router as gstRouter };
