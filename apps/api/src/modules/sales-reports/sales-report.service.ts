import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../../infrastructure/database';
import { logger } from '../../infrastructure/logger';
import { jobs } from '../../infrastructure/queues';
import type { SalesReportEmailData } from '../../infrastructure/email';
import { config } from '../../config';
import { roundTo, toDecimal } from '../../shared/helpers/response.helper';
import { isUniqueViolation } from '../../shared/helpers/sequence';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Scheduled sales report.
 *
 * Nothing runs inside the API on a timer (free hosts sleep and stop timers). An external scheduler calls
 * POST /api/v1/internal/sales-reports/run at 07:00, 11:00, 15:00, 19:00 and 22:00 IST; each call stores
 * one snapshot per organization for the current slot and emails it to the org's owner/admins.
 */

/** Local hours (org timezone) of the scheduled runs: every 4 hours from 7am, plus a 10pm close. */
export const SALES_REPORT_SLOTS = [7, 11, 15, 19, 22] as const;
const CLOSING_SLOT = 22;
const RECIPIENT_ROLES: UserRole[] = ['ORG_OWNER', 'BRANCH_ADMIN'];
const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export interface SalesSnapshotData {
  invoiceCount: number;
  totalSales: number;
  taxableAmount: number;
  taxAmount: number;
  discountAmount: number;
  averageBill: number;
  collected: number;
  outstanding: number;
  collectedByMode: Array<{ mode: string; amount: number }>;
  topProducts: Array<{ productId: string; name: string; quantity: number; amount: number }>;
}

/** Latest slot at or before `now` in the timezone (a late trigger still fills its slot), or null before 7am. */
export function currentSlot(now: Date, tz: string): { reportDate: string; slot: number } | null {
  const local = dayjs(now).tz(tz);
  const slot = [...SALES_REPORT_SLOTS].reverse().find((h) => local.hour() >= h);
  return slot === undefined ? null : { reportDate: local.format('YYYY-MM-DD'), slot };
}

export function slotLabel(slot: number): string {
  return dayjs().hour(slot).minute(0).format('h:mm A');
}

/** Today's sales so far for one org: bills dated `reportDate` (local day) and money received that day. */
export async function buildSalesSnapshot(organizationId: string, tz: string, reportDate: string): Promise<SalesSnapshotData> {
  // The local calendar day as a UTC range. Bills dated with a plain date (stored as UTC midnight) fall inside
  // it for timezones ahead of UTC such as Asia/Kolkata, and so do bills stamped with a full timestamp.
  const dayStart = dayjs.tz(reportDate, tz).toDate();
  const dayEnd = dayjs.tz(reportDate, tz).add(1, 'day').toDate();
  const invoiceWhere: Prisma.InvoiceWhereInput = {
    organizationId,
    invoiceDate: { gte: dayStart, lt: dayEnd },
    status: { notIn: ['DRAFT', 'CANCELLED'] },
  };

  const [sales, topItems, receipts] = await Promise.all([
    prisma.invoice.aggregate({
      where: invoiceWhere,
      _sum: { totalAmount: true, taxableAmount: true, taxAmount: true, discountAmount: true, balanceAmount: true },
      _count: { id: true },
    }),
    prisma.invoiceItem.groupBy({
      by: ['productId'],
      where: { invoice: invoiceWhere, productId: { not: null } },
      _sum: { quantity: true, amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 5,
    }),
    prisma.payment.groupBy({
      by: ['mode'],
      where: { organizationId, type: 'RECEIPT', paymentDate: { gte: dayStart, lt: dayEnd }, status: { notIn: ['FAILED', 'REFUNDED'] } },
      _sum: { amount: true },
    }),
  ]);

  const products = await prisma.product.findMany({
    where: { id: { in: topItems.map((i) => i.productId!) }, organizationId },
    select: { id: true, name: true },
  });

  const invoiceCount = sales._count.id;
  const totalSales = toDecimal(sales._sum.totalAmount);
  const collectedByMode = receipts
    .map((r) => ({ mode: r.mode, amount: toDecimal(r._sum.amount) }))
    .sort((a, b) => b.amount - a.amount);

  return {
    invoiceCount,
    totalSales,
    taxableAmount: toDecimal(sales._sum.taxableAmount),
    taxAmount: toDecimal(sales._sum.taxAmount),
    discountAmount: toDecimal(sales._sum.discountAmount),
    averageBill: invoiceCount ? roundTo(totalSales / invoiceCount) : 0,
    collected: roundTo(collectedByMode.reduce((s, m) => s + m.amount, 0)),
    outstanding: toDecimal(sales._sum.balanceAmount),
    collectedByMode,
    topProducts: topItems.map((i) => ({
      productId: i.productId!,
      name: products.find((p) => p.id === i.productId)?.name ?? 'Item',
      quantity: toDecimal(i._sum.quantity),
      amount: toDecimal(i._sum.amount),
    })),
  };
}

type OrgRow = { id: string; name: string; timezone: string; currency: string };

async function runForOrganization(org: OrgRow, now: Date): Promise<'created' | 'skipped'> {
  const tz = org.timezone || DEFAULT_TIMEZONE;
  const current = currentSlot(now, tz);
  if (!current) return 'skipped';
  const reportDate = new Date(`${current.reportDate}T00:00:00.000Z`);
  const key = { organizationId: org.id, reportDate, slot: current.slot };

  // Cheap pre-check; the unique key on insert is what makes overlapping triggers a no-op.
  if (await prisma.salesReportSnapshot.count({ where: key })) return 'skipped';

  const data = await buildSalesSnapshot(org.id, tz, current.reportDate);
  const recipients = await prisma.userOrganization.findMany({
    where: { organizationId: org.id, isActive: true, role: { in: RECIPIENT_ROLES }, user: { isActive: true } },
    select: { user: { select: { email: true } } },
  });
  const emails = [...new Set(recipients.map((r) => r.user.email))];

  try {
    await prisma.salesReportSnapshot.create({
      data: { ...key, generatedAt: now, data: data as unknown as Prisma.InputJsonValue, emailedTo: emails },
    });
  } catch (err) {
    if (isUniqueViolation(err, 'slot')) return 'skipped';
    throw err;
  }

  const email: SalesReportEmailData = {
    organizationName: org.name,
    reportDate: current.reportDate,
    slotLabel: slotLabel(current.slot),
    isClosing: current.slot === CLOSING_SLOT,
    currency: org.currency,
    totals: data,
    collectedByMode: data.collectedByMode,
    topProducts: data.topProducts,
    viewUrl: `${config.APP_URL}/reports?type=sales`,
  };
  for (const to of emails) {
    await jobs.sendEmail({ type: 'sales-report', to, organizationId: org.id, data: email as unknown as Record<string, unknown> });
  }
  return 'created';
}

/** One pass over every active organization; a failure in one org is logged and does not stop the others. */
export async function runScheduledSalesReports(now = new Date()) {
  const orgs = await prisma.organization.findMany({
    where: { isActive: true },
    select: { id: true, name: true, timezone: true, currency: true },
  });

  const result = { created: 0, skipped: 0, failed: 0 };
  for (const org of orgs) {
    try {
      result[await runForOrganization(org, now)]++;
    } catch (err) {
      result.failed++;
      logger.error({ err, organizationId: org.id }, 'Scheduled sales report failed');
    }
  }
  logger.info(result, 'Scheduled sales reports run');
  return result;
}
