import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

router.get('/revenue', async (req: Request, res: Response) => {
  const { period = '12months' } = req.query as any;
  const months = period === '3months' ? 3 : period === '6months' ? 6 : 12;
  const from = new Date(new Date().getFullYear(), new Date().getMonth() - months + 1, 1);

  const revenue = await prisma.$queryRaw<any[]>`
    SELECT DATE_TRUNC('month', "invoiceDate") as month,
           SUM("totalAmount")::float as revenue,
           SUM("paidAmount")::float as collected,
           SUM("taxAmount")::float as gst,
           COUNT(id) as invoices
    FROM invoices
    WHERE "organizationId" = ${req.organizationId!}
      AND "invoiceDate" >= ${from}
      AND status != 'CANCELLED'
    GROUP BY DATE_TRUNC('month', "invoiceDate")
    ORDER BY month ASC
  `;
  res.json(successResponse(revenue));
});

router.get('/products', async (req: Request, res: Response) => {
  const { fromDate, toDate } = req.query as any;
  const from = fromDate ? new Date(fromDate) : new Date(new Date().getFullYear(), 0, 1);
  const to = toDate ? new Date(toDate) : new Date();

  const [topByRevenue, topByQuantity, categoryBreakdown] = await Promise.all([
    prisma.invoiceItem.groupBy({
      by: ['productId'],
      where: { invoice: { organizationId: req.organizationId!, invoiceDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } } },
      _sum: { quantity: true, amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 15,
    }),
    prisma.invoiceItem.groupBy({
      by: ['productId'],
      where: { invoice: { organizationId: req.organizationId!, invoiceDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } } },
      _sum: { quantity: true, amount: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 15,
    }),
    prisma.$queryRaw<any[]>`
      SELECT pc.name as category,
             SUM(ii."amount")::float as revenue,
             SUM(ii.quantity)::float as quantity
      FROM invoice_items ii
      JOIN products p ON ii."productId" = p.id
      LEFT JOIN product_categories pc ON p."categoryId" = pc.id
      JOIN invoices i ON ii."invoiceId" = i.id
      WHERE i."organizationId" = ${req.organizationId!}
        AND i."invoiceDate" >= ${from}
        AND i."invoiceDate" <= ${to}
        AND i.status != 'CANCELLED'
      GROUP BY pc.name
      ORDER BY revenue DESC
    `,
  ]);

  const allProductIds = [...new Set([...topByRevenue, ...topByQuantity].map(p => p.productId!))].filter(Boolean);
  const products = await prisma.product.findMany({ where: { id: { in: allProductIds }, organizationId: req.organizationId! }, select: { id: true, name: true, sku: true, openingStock: true } });

  res.json(successResponse({
    topByRevenue: topByRevenue.map(p => ({ ...p, product: products.find(pr => pr.id === p.productId) })),
    topByQuantity: topByQuantity.map(p => ({ ...p, product: products.find(pr => pr.id === p.productId) })),
    categoryBreakdown,
  }));
});

router.get('/customers', async (req: Request, res: Response) => {
  const { fromDate, toDate } = req.query as any;
  const from = fromDate ? new Date(fromDate) : new Date(new Date().getFullYear(), 0, 1);
  const to = toDate ? new Date(toDate) : new Date();

  const [topCustomers, newVsReturning, customerGrowth] = await Promise.all([
    prisma.invoice.groupBy({
      by: ['customerId'],
      where: { organizationId: req.organizationId!, invoiceDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
      _sum: { totalAmount: true, paidAmount: true },
      _count: { id: true },
      orderBy: { _sum: { totalAmount: 'desc' } },
      take: 10,
    }),
    prisma.$queryRaw<any[]>`
      SELECT
        COUNT(DISTINCT c.id) FILTER (WHERE c."createdAt" >= ${from}) as new_customers,
        COUNT(DISTINCT i."customerId") FILTER (WHERE i."invoiceDate" >= ${from}) as active_customers
      FROM customers c
      LEFT JOIN invoices i ON c.id = i."customerId"
      WHERE c."organizationId" = ${req.organizationId!}
    `,
    prisma.$queryRaw<any[]>`
      SELECT DATE_TRUNC('month', "createdAt") as month, COUNT(id) as count
      FROM customers
      WHERE "organizationId" = ${req.organizationId!}
        AND "createdAt" >= ${from}
      GROUP BY DATE_TRUNC('month', "createdAt")
      ORDER BY month ASC
    `,
  ]);

  const customerIds = topCustomers.map(c => c.customerId!).filter(Boolean);
  const customers = await prisma.customer.findMany({ where: { id: { in: customerIds }, organizationId: req.organizationId! }, select: { id: true, name: true, phone: true, email: true } });

  res.json(successResponse({
    topCustomers: topCustomers.map(c => ({ ...c, customer: customers.find(cu => cu.id === c.customerId) })),
    newVsReturning: newVsReturning[0],
    customerGrowth,
  }));
});

// Real money in/out by month. Payments are matched to the org directly or via their invoice/purchase
// (invoice payments recorded by billing may lack organizationId). Outflows = supplier payments (incl. amounts
// paid at purchase time); expenses are reported separately; failed payments and rejected expenses are excluded.
router.get('/cash-flow', async (req: Request, res: Response) => {
  const { months = 6 } = req.query as any;
  const n = Math.min(Math.max(parseInt(String(months), 10) || 6, 1), 36);
  const from = new Date(new Date().getFullYear(), new Date().getMonth() - n + 1, 1);
  const org = req.organizationId!;

  const paymentsByMonth = (type: string) => prisma.$queryRaw<any[]>`
    SELECT DATE_TRUNC('month', p."paymentDate") as month, SUM(p.amount)::float as amount
    FROM payments p
    LEFT JOIN invoices i ON i.id = p."invoiceId"
    LEFT JOIN purchases pu ON pu.id = p."purchaseId"
    WHERE COALESCE(p."organizationId", i."organizationId", pu."organizationId") = ${org}
      AND p.type = ${type} AND p.status <> 'FAILED' AND p."paymentDate" >= ${from}
    GROUP BY DATE_TRUNC('month', p."paymentDate") ORDER BY month ASC
  `;

  const [inflows, outflows, expenses] = await Promise.all([
    paymentsByMonth('RECEIPT'),
    paymentsByMonth('PAYMENT'),
    prisma.$queryRaw<any[]>`
      SELECT DATE_TRUNC('month', "expenseDate") as month, SUM("totalAmount")::float as amount
      FROM expenses WHERE "organizationId" = ${org} AND status <> 'REJECTED' AND "expenseDate" >= ${from}
      GROUP BY DATE_TRUNC('month', "expenseDate") ORDER BY month ASC
    `,
  ]);

  const sum = (rows: any[]) => Math.round(rows.reduce((s, r) => s + Number(r.amount || 0), 0) * 100) / 100;
  const totals = { inflow: sum(inflows), outflow: sum(outflows), expenses: sum(expenses), net: 0 };
  totals.net = Math.round((totals.inflow - totals.outflow - totals.expenses) * 100) / 100;

  res.json(successResponse({ inflows, outflows, expenses, totals }));
});

// Alias routes for test compatibility
router.get('/top-customers', async (req: Request, res: Response) => {
  const { limit = 10 } = req.query as any;
  const topCustomers = await prisma.invoice.groupBy({
    by: ['customerId'],
    where: { organizationId: req.organizationId!, status: { not: 'CANCELLED' } },
    _sum: { totalAmount: true },
    _count: { id: true },
    orderBy: { _sum: { totalAmount: 'desc' } },
    take: +limit,
  });
  const customerIds = topCustomers.map(c => c.customerId!).filter(Boolean);
  const customers = await prisma.customer.findMany({ where: { id: { in: customerIds }, organizationId: req.organizationId! }, select: { id: true, name: true, phone: true, email: true } });
  res.json(successResponse(topCustomers.map(c => ({ ...c, customer: customers.find(cu => cu.id === c.customerId) }))));
});

router.get('/top-products', async (req: Request, res: Response) => {
  const { limit = 10 } = req.query as any;
  const topProducts = await prisma.invoiceItem.groupBy({
    by: ['productId'],
    where: { invoice: { organizationId: req.organizationId!, status: { not: 'CANCELLED' } } },
    _sum: { quantity: true, amount: true },
    orderBy: { _sum: { amount: 'desc' } },
    take: +limit,
  });
  const productIds = topProducts.map(p => p.productId!).filter(Boolean);
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, organizationId: req.organizationId! }, select: { id: true, name: true, sku: true } });
  res.json(successResponse(topProducts.map(p => ({ ...p, product: products.find(pr => pr.id === p.productId) }))));
});

export { router as analyticsRouter };
