import { Router } from 'express';
import { Request, Response } from 'express';
import { prisma } from '../../infrastructure/database';
import { successResponse } from '../../shared/helpers/response.helper';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { tenantMiddleware } from '../../shared/middleware/tenant';

const router = Router();
router.use(authMiddleware);

// ── Super-admin platform-wide dashboard ──────────────────────────────────────
router.get('/admin', async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user?.isSuperAdmin) return res.status(403).json({ message: 'Forbidden' });

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const last30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalOrgs, activeOrgs, newOrgsThisMonth,
    totalUsers, totalInvoices, totalRevenue,
    planBreakdown, recentOrgs,
    revenueByDay,
  ] = await Promise.all([
    prisma.organization.count(),
    prisma.organization.count({ where: { isActive: true } }),
    prisma.organization.count({ where: { createdAt: { gte: startOfMonth } } }),
    prisma.user.count(),
    prisma.invoice.count({ where: { status: { not: 'CANCELLED' } } }),
    prisma.invoice.aggregate({ where: { status: { not: 'CANCELLED' } }, _sum: { totalAmount: true } }),
    prisma.subscription.groupBy({ by: ['plan'], _count: { id: true }, orderBy: { _count: { id: 'desc' } } }),
    prisma.organization.findMany({ orderBy: { createdAt: 'desc' }, take: 8, include: { subscription: { select: { plan: true, status: true } }, _count: { select: { users: true } } } }),
    prisma.$queryRaw<any[]>`
      SELECT DATE("createdAt") as day, COUNT(id)::int as orgs
      FROM organizations
      WHERE "createdAt" >= ${last30}
      GROUP BY DATE("createdAt")
      ORDER BY day ASC
    `,
  ]);

  res.json(successResponse({
    platform: {
      totalOrgs, activeOrgs, newOrgsThisMonth,
      totalUsers, totalInvoices,
      totalRevenue: Number(totalRevenue._sum.totalAmount || 0),
    },
    planBreakdown: planBreakdown.map(p => ({ plan: p.plan, count: p._count.id })),
    recentOrgs,
    revenueByDay,
  }));
});

// ── Org-scoped dashboard (requires tenant) ───────────────────────────────────
router.use(tenantMiddleware);

router.get('/', async (req: Request, res: Response) => {
  const orgId = req.organizationId!;
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const startOfToday = new Date(now.setHours(0, 0, 0, 0));

  const [
    salesThisMonth, salesToday, purchasesThisMonth,
    outstandingReceivables, outstandingPayables,
    inventoryValue, lowStockCount, expensesThisMonth,
    recentInvoices, recentPurchases, topCustomers,
  ] = await Promise.all([
    prisma.invoice.aggregate({ where: { organizationId: orgId, invoiceDate: { gte: startOfMonth }, status: { not: 'CANCELLED' } }, _sum: { totalAmount: true, paidAmount: true, balanceAmount: true }, _count: { id: true } }),
    prisma.invoice.aggregate({ where: { organizationId: orgId, invoiceDate: { gte: startOfToday }, status: { not: 'CANCELLED' } }, _sum: { totalAmount: true }, _count: { id: true } }),
    prisma.purchase.aggregate({ where: { organizationId: orgId, purchaseDate: { gte: startOfMonth }, status: { not: 'CANCELLED' } }, _sum: { totalAmount: true }, _count: { id: true } }),
    // Outstanding receivables = sum of invoice balanceAmount > 0
    prisma.invoice.aggregate({ where: { organizationId: orgId, balanceAmount: { gt: 0 }, status: { notIn: ['CANCELLED', 'DRAFT'] } }, _sum: { balanceAmount: true }, _count: { id: true } }),
    // Outstanding payables = sum of purchase balanceAmount > 0
    prisma.purchase.aggregate({ where: { organizationId: orgId, balanceAmount: { gt: 0 }, status: { notIn: ['CANCELLED', 'DRAFT'] } }, _sum: { balanceAmount: true }, _count: { id: true } }),
    prisma.product.aggregate({ where: { organizationId: orgId, isActive: true, trackInventory: true }, _sum: { openingStock: true } }),
    prisma.product.count({ where: { organizationId: orgId, isActive: true, trackInventory: true, openingStock: { lte: prisma.product.fields.reorderPoint } } }),
    prisma.expense.aggregate({ where: { organizationId: orgId, expenseDate: { gte: startOfMonth } }, _sum: { amount: true }, _count: { id: true } }),
    prisma.invoice.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 5, include: { customer: { select: { name: true } } } }),
    prisma.purchase.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 5, include: { supplier: { select: { name: true } } } }),
    prisma.invoice.groupBy({ by: ['customerId'], where: { organizationId: orgId, balanceAmount: { gt: 0 } }, _sum: { balanceAmount: true }, orderBy: { _sum: { balanceAmount: 'desc' } }, take: 5 }),
  ]);

  // Trend data (last 6 months)
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const monthlyTrend = await prisma.$queryRaw<any[]>`
    SELECT DATE_TRUNC('month', "invoiceDate") as month,
           SUM("totalAmount")::float as sales,
           COUNT(id)::int as count
    FROM invoices
    WHERE "organizationId" = ${orgId}
      AND "invoiceDate" >= ${sixMonthsAgo}
      AND status != 'CANCELLED'
    GROUP BY DATE_TRUNC('month', "invoiceDate")
    ORDER BY month ASC
  `;

  const gstSummary = await prisma.invoice.aggregate({
    where: { organizationId: orgId, invoiceDate: { gte: startOfMonth }, status: { not: 'CANCELLED' } },
    _sum: { cgstAmount: true, sgstAmount: true, igstAmount: true, taxAmount: true },
  });

  res.json(successResponse({
    kpis: {
      salesThisMonth: { amount: Number(salesThisMonth._sum.totalAmount || 0), count: salesThisMonth._count.id, collected: Number(salesThisMonth._sum.paidAmount || 0), outstanding: Number(salesThisMonth._sum.balanceAmount || 0) },
      salesToday: { amount: Number(salesToday._sum.totalAmount || 0), count: salesToday._count.id },
      purchasesThisMonth: { amount: Number(purchasesThisMonth._sum.totalAmount || 0), count: purchasesThisMonth._count.id },
      outstandingReceivables: { amount: Number(outstandingReceivables._sum.balanceAmount || 0), count: outstandingReceivables._count?.id ?? 0 },
      outstandingPayables: { amount: Number(outstandingPayables._sum.balanceAmount || 0), count: outstandingPayables._count?.id ?? 0 },
      expenses: { amount: Number(expensesThisMonth._sum.amount || 0), count: expensesThisMonth._count?.id ?? 0 },
      gstLiability: Number(gstSummary._sum.taxAmount || 0),
      lowStockAlerts: lowStockCount,
    },
    trends: { monthly: monthlyTrend },
    recentActivity: { invoices: recentInvoices, purchases: recentPurchases },
    topCustomers,
  }));
});

export { router as dashboardRouter };
