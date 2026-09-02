import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';
import { Prisma } from '@prisma/client';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

// ─── Sales Reports ─────────────────────────────────────────────────────────────
router.get('/sales/summary', async (req: Request, res: Response) => {
  const { fromDate, toDate, groupBy = 'day' } = req.query as any;
  const from = fromDate ? new Date(fromDate) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const to = toDate ? new Date(toDate) : new Date();

  const [summary, byStatus, topProducts, topCustomers] = await Promise.all([
    prisma.invoice.aggregate({
      where: { organizationId: req.organizationId!, invoiceDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
      _sum: { totalAmount: true, taxAmount: true, discountAmount: true, paidAmount: true, balanceAmount: true },
      _count: { id: true },
    }),
    prisma.invoice.groupBy({
      by: ['status'],
      where: { organizationId: req.organizationId!, invoiceDate: { gte: from, lte: to } },
      _sum: { totalAmount: true },
      _count: { id: true },
    }),
    prisma.invoiceItem.groupBy({
      by: ['productId'],
      where: { invoice: { organizationId: req.organizationId!, invoiceDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } } },
      _sum: { quantity: true, amount: true },
      _count: { id: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 10,
    }),
    prisma.invoice.groupBy({
      by: ['customerId'],
      where: { organizationId: req.organizationId!, invoiceDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
      _sum: { totalAmount: true },
      orderBy: { _sum: { totalAmount: 'desc' } },
      take: 10,
    }),
  ]);

  // Get product names
  const productIds = topProducts.map(p => p.productId!).filter(Boolean);
  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, sku: true } });

  // Get customer names
  const customerIds = topCustomers.map(c => c.customerId!).filter(Boolean);
  const customers = await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } });

  res.json(successResponse({
    summary,
    byStatus,
    topProducts: topProducts.map(p => ({ ...p, product: products.find(pr => pr.id === p.productId) })),
    topCustomers: topCustomers.map(c => ({ ...c, customer: customers.find(cu => cu.id === c.customerId) })),
  }));
});

// ─── Purchase Reports ─────────────────────────────────────────────────────────
router.get('/purchases/summary', async (req: Request, res: Response) => {
  const { fromDate, toDate } = req.query as any;
  const from = fromDate ? new Date(fromDate) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const to = toDate ? new Date(toDate) : new Date();

  const [summary, topSuppliers] = await Promise.all([
    prisma.purchase.aggregate({
      where: { organizationId: req.organizationId!, purchaseDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
      _sum: { totalAmount: true, taxAmount: true, paidAmount: true, balanceAmount: true },
      _count: { id: true },
    }),
    prisma.purchase.groupBy({
      by: ['supplierId'],
      where: { organizationId: req.organizationId!, purchaseDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
      _sum: { totalAmount: true },
      orderBy: { _sum: { totalAmount: 'desc' } },
      take: 10,
    }),
  ]);

  const supplierIds = topSuppliers.map(s => s.supplierId!).filter(Boolean);
  const suppliers = await prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true } });

  res.json(successResponse({
    summary,
    topSuppliers: topSuppliers.map(s => ({ ...s, supplier: suppliers.find(su => su.id === s.supplierId) })),
  }));
});

// ─── Outstanding Reports ──────────────────────────────────────────────────────
router.get('/outstanding/receivables', async (req: Request, res: Response) => {
  const invoices = await prisma.invoice.findMany({
    where: { organizationId: req.organizationId!, balanceAmount: { gt: 0 }, status: { not: 'CANCELLED' } },
    select: { customerId: true, balanceAmount: true, dueDate: true },
  });
  const customerMap = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.customerId) customerMap.set(inv.customerId, (customerMap.get(inv.customerId) ?? 0) + Number(inv.balanceAmount));
  }
  const customerIds = Array.from(customerMap.keys());
  const customers = await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true, phone: true, email: true, creditDays: true } });
  const result = customers.map(c => ({ ...c, outstandingAmount: customerMap.get(c.id) ?? 0 })).sort((a, b) => b.outstandingAmount - a.outstandingAmount);
  const total = result.reduce((s, c) => s + c.outstandingAmount, 0);
  res.json(successResponse({ customers: result, totalOutstanding: total }));
});

router.get('/outstanding/payables', async (req: Request, res: Response) => {
  const purchases = await prisma.purchase.findMany({
    where: { organizationId: req.organizationId!, balanceAmount: { gt: 0 }, status: { not: 'CANCELLED' } },
    select: { supplierId: true, balanceAmount: true },
  });
  const supplierMap = new Map<string, number>();
  for (const pur of purchases) {
    if (pur.supplierId) supplierMap.set(pur.supplierId, (supplierMap.get(pur.supplierId) ?? 0) + Number(pur.balanceAmount));
  }
  const supplierIds = Array.from(supplierMap.keys());
  const suppliers = await prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true, phone: true } });
  const result = suppliers.map(s => ({ ...s, outstandingAmount: supplierMap.get(s.id) ?? 0 })).sort((a, b) => b.outstandingAmount - a.outstandingAmount);
  const total = result.reduce((s, su) => s + su.outstandingAmount, 0);
  res.json(successResponse({ suppliers: result, totalPayable: total }));
});

// ─── Expense Reports ──────────────────────────────────────────────────────────
router.get('/expenses/summary', async (req: Request, res: Response) => {
  const { fromDate, toDate } = req.query as any;
  const from = fromDate ? new Date(fromDate) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const to = toDate ? new Date(toDate) : new Date();

  const [summary, byCategory] = await Promise.all([
    prisma.expense.aggregate({
      where: { organizationId: req.organizationId!, expenseDate: { gte: from, lte: to } },
      _sum: { amount: true },
      _count: { id: true },
    }),
    prisma.expense.groupBy({
      by: ['categoryId'],
      where: { organizationId: req.organizationId!, expenseDate: { gte: from, lte: to } },
      _sum: { amount: true },
      _count: { id: true },
    }),
  ]);

  const categoryIds = byCategory.map(c => c.categoryId!).filter(Boolean);
  const categories = await prisma.expenseCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } });

  res.json(successResponse({
    summary,
    byCategory: byCategory.map(c => ({ ...c, category: categories.find(ca => ca.id === c.categoryId) })),
  }));
});

// ─── Inventory Reports ────────────────────────────────────────────────────────
router.get('/inventory/aging', async (req: Request, res: Response) => {
  const products = await prisma.product.findMany({
    where: { organizationId: req.organizationId!, isActive: true, trackInventory: true, openingStock: { gt: 0 } },
    include: { category: { select: { name: true } } },
  });

  const now = new Date();
  const lastMovements = await prisma.stockEntry.groupBy({
    by: ['productId'],
    where: { organizationId: req.organizationId!, movementType: { in: ['SALE', 'ADJUSTMENT_OUT'] } },
    _max: { createdAt: true },
  });

  const result = products.map((p: any) => {
    const lastSale = lastMovements.find((m: any) => m.productId === p.id)?._max.createdAt;
    const daysSinceLastSale = lastSale ? Math.floor((now.getTime() - lastSale.getTime()) / (1000 * 60 * 60 * 24)) : null;
    return { ...p, daysSinceLastSale, stockValue: Number(p.openingStock) * Number(p.costPrice) };
  });

  result.sort((a, b) => (b.daysSinceLastSale ?? 9999) - (a.daysSinceLastSale ?? 9999));
  res.json(successResponse(result));
});

router.get('/inventory/fast-moving', async (req: Request, res: Response) => {
  const { days = 30 } = req.query as any;
  const from = new Date(Date.now() - +days * 24 * 60 * 60 * 1000);

  const movements = await prisma.stockEntry.groupBy({
    by: ['productId'],
    where: { organizationId: req.organizationId!, movementType: 'SALE', createdAt: { gte: from } },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: 20,
  });

  const productIds = movements.map((m: any) => m.productId!).filter(Boolean);
  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, sku: true, openingStock: true, sellingPrice: true } });

  res.json(successResponse(movements.map((m: any) => ({ ...m, product: products.find(p => p.id === m.productId) }))));
});

// ─── Alias routes (for backward-compatible test URLs) ─────────────────────────
router.get('/sales-summary', async (req: Request, res: Response) => {
  const { fromDate, toDate, startDate, endDate } = req.query as any;
  const from = (fromDate || startDate) ? new Date(fromDate || startDate) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const to = (toDate || endDate) ? new Date(toDate || endDate) : new Date();
  const summary = await prisma.invoice.aggregate({
    where: { organizationId: req.organizationId!, invoiceDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
    _sum: { totalAmount: true, taxAmount: true, discountAmount: true, paidAmount: true, balanceAmount: true },
    _count: { id: true },
  });
  res.json(successResponse({ summary }));
});

router.get('/purchase-summary', async (req: Request, res: Response) => {
  const { fromDate, toDate, startDate, endDate } = req.query as any;
  const from = (fromDate || startDate) ? new Date(fromDate || startDate) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const to = (toDate || endDate) ? new Date(toDate || endDate) : new Date();
  const summary = await prisma.purchase.aggregate({
    where: { organizationId: req.organizationId!, purchaseDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
    _sum: { totalAmount: true, taxAmount: true, paidAmount: true, balanceAmount: true },
    _count: { id: true },
  });
  res.json(successResponse({ summary }));
});

router.get('/outstanding-receivables', async (req: Request, res: Response) => {
  const invoices = await prisma.invoice.findMany({
    where: { organizationId: req.organizationId!, balanceAmount: { gt: 0 }, status: { not: 'CANCELLED' } },
    select: { customerId: true, balanceAmount: true, dueDate: true },
  });
  const customerMap = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.customerId) customerMap.set(inv.customerId, (customerMap.get(inv.customerId) ?? 0) + Number(inv.balanceAmount));
  }
  const customerIds = Array.from(customerMap.keys());
  const customers = await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true, phone: true, email: true } });
  const result = customers.map(c => ({ ...c, outstandingAmount: customerMap.get(c.id) ?? 0 })).sort((a, b) => b.outstandingAmount - a.outstandingAmount);
  const total = result.reduce((s, c) => s + c.outstandingAmount, 0);
  res.json(successResponse({ customers: result, totalOutstanding: total }));
});

router.get('/outstanding-payables', async (req: Request, res: Response) => {
  const purchases = await prisma.purchase.findMany({
    where: { organizationId: req.organizationId!, balanceAmount: { gt: 0 }, status: { not: 'CANCELLED' } },
    select: { supplierId: true, balanceAmount: true },
  });
  const supplierMap = new Map<string, number>();
  for (const pur of purchases) {
    if (pur.supplierId) supplierMap.set(pur.supplierId, (supplierMap.get(pur.supplierId) ?? 0) + Number(pur.balanceAmount));
  }
  const supplierIds = Array.from(supplierMap.keys());
  const suppliers = await prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true, phone: true } });
  const result = suppliers.map(s => ({ ...s, outstandingAmount: supplierMap.get(s.id) ?? 0 })).sort((a, b) => b.outstandingAmount - a.outstandingAmount);
  const total = result.reduce((s, su) => s + su.outstandingAmount, 0);
  res.json(successResponse({ suppliers: result, totalPayable: total }));
});

export { router as reportRouter };
