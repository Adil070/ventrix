'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Receipt, Users, Tag, Package } from 'lucide-react';
import api from '@/lib/api';
import { cn, formatCurrency } from '@/lib/utils';
import { plural } from '@/lib/business';
import { PageHeader, Card, LoadingSpinner } from '@/components/shared';

type ReportType = 'sales' | 'purchases' | 'outstanding' | 'expenses' | 'inventory';
const REPORT_TYPES: ReportType[] = ['sales', 'purchases', 'outstanding', 'expenses', 'inventory'];

const REPORTS = [
  { key: 'sales', label: 'Sales', icon: BarChart3, description: 'What you sold, best items, best customers' },
  { key: 'purchases', label: 'Purchases', icon: Receipt, description: 'What you bought and from whom' },
  { key: 'outstanding', label: 'Who owes what', icon: Users, description: 'Money to collect and to pay' },
  { key: 'expenses', label: 'Expenses', icon: Tag, description: 'Where the money went' },
  { key: 'inventory', label: 'Stock', icon: Package, description: 'What you have and what it’s worth' },
] as const;

type Period = 'month' | 'lastMonth' | 'fy' | 'all';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'fy', label: 'This financial year' },
  { key: 'all', label: 'All time' },
];

function periodRange(p: Period) {
  const now = new Date();
  let from = new Date(now.getFullYear(), now.getMonth(), 1);
  let to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (p === 'lastMonth') {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  }
  // Indian financial year starts on 1 April.
  if (p === 'fy') from = new Date(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1, 3, 1);
  if (p === 'all') from = new Date(2000, 0, 1);
  return { fromDate: from.toISOString(), toDate: to.toISOString() };
}

// Report endpoints return Prisma aggregates with Decimal values as strings.
const num = (v: unknown) => Number(v || 0);

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={cn('text-2xl font-bold mt-1', tone === 'good' ? 'text-green-600' : tone === 'bad' ? 'text-red-600' : 'text-gray-900 dark:text-white')}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </Card>
  );
}

function RankedList({ title, rows, empty }: { title: string; rows: { key: string; label: string; sub?: string; value: number }[]; empty: string }) {
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <Card className="p-5">
      <h3 className="font-semibold text-gray-900 dark:text-white mb-3">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-gray-500 py-4 text-center">{empty}</p> : (
        <div className="space-y-3">
          {rows.map(r => (
            <div key={r.key}>
              <div className="flex justify-between text-sm">
                <span className="text-gray-700 dark:text-gray-300">{r.label}{r.sub && <span className="text-gray-400"> · {r.sub}</span>}</span>
                <span className="font-semibold">{formatCurrency(r.value)}</span>
              </div>
              <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full mt-1">
                <div className="h-1.5 bg-orange-400 rounded-full" style={{ width: `${(r.value / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const slotLabel = (hour: number) => `${hour % 12 || 12}:00 ${hour < 12 ? 'AM' : 'PM'}`;

// The scheduled runs (7am, 11am, 3pm, 7pm and the 10pm close) of the most recent day that has any.
function SalesUpdates({ snapshots }: { snapshots: any[] }) {
  const day = snapshots[0]?.reportDate;
  const rows = snapshots.filter(s => s.reportDate === day).sort((a, b) => a.slot - b.slot);
  if (!rows.length) return null;
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-semibold text-gray-900 dark:text-white">Sales updates</h3>
        <span className="text-xs text-gray-400">{new Date(day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })} · also emailed to owners</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs font-semibold text-gray-500 uppercase border-b border-gray-200 dark:border-gray-700">
            <th className="text-left py-2">As of</th><th className="text-right py-2">Sales</th><th className="text-right py-2">Bills</th><th className="text-right py-2">Collected</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(s => (
            <tr key={s.id} className="border-b border-gray-100 dark:border-gray-700 last:border-0">
              <td className="py-2">{s.slot === 22 ? 'Day close (10:00 PM)' : slotLabel(s.slot)}</td>
              <td className="py-2 text-right font-semibold">{formatCurrency(num(s.data?.totalSales))}</td>
              <td className="py-2 text-right">{num(s.data?.invoiceCount)}</td>
              <td className="py-2 text-right text-green-600">{formatCurrency(num(s.data?.collected))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function PartyTable({ title, rows, empty, tone }: { title: string; rows: any[]; empty: string; tone: string }) {
  const total = rows.reduce((s, r) => s + num(r.outstandingAmount), 0);
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className={cn('font-semibold', tone)}>{title}</h3>
        {total > 0 && <span className={cn('font-bold', tone)}>{formatCurrency(total)}</span>}
      </div>
      {rows.length === 0 ? <p className="text-center py-4 text-gray-500 text-sm">{empty}</p> : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700 last:border-0">
                <td className="py-2">{r.name}{r.phone && <span className="block text-xs text-gray-400">{r.phone}</span>}</td>
                <td className={cn('py-2 text-right font-semibold', tone)}>{formatCurrency(num(r.outstandingAmount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export default function ReportsPage() {
  // Home links straight to a report, e.g. /reports?type=outstanding for "who owes you".
  const requested = useSearchParams().get('type') as ReportType | null;
  const [reportType, setReportType] = useState<ReportType>(requested && REPORT_TYPES.includes(requested) ? requested : 'sales');
  const [period, setPeriod] = useState<Period>('month');
  const range = periodRange(period);
  const periodLabel = PERIODS.find(p => p.key === period)!.label.toLowerCase();

  const sales = useQuery({ queryKey: ['report-sales', period], queryFn: () => api.reports.getSalesSummary(range), select: r => r.data.data, enabled: reportType === 'sales' });
  const snapshots = useQuery({ queryKey: ['report-sales-snapshots'], queryFn: () => api.reports.getSalesSnapshots(), select: r => (r.data.data || []) as any[], enabled: reportType === 'sales' });
  const purchases = useQuery({ queryKey: ['report-purchases', period], queryFn: () => api.reports.getPurchasesSummary(range), select: r => r.data.data, enabled: reportType === 'purchases' });
  const expenses = useQuery({ queryKey: ['report-expenses', period], queryFn: () => api.reports.getExpensesSummary(range), select: r => r.data.data, enabled: reportType === 'expenses' });
  const outstanding = useQuery({
    queryKey: ['report-outstanding'],
    queryFn: () => api.reports.getOutstanding(),
    // The API nests the rows: { receivables: { customers: [...] }, payables: { suppliers: [...] } }.
    select: r => {
      const d = r.data.data;
      return { receivables: (d?.receivables?.customers ?? []) as any[], payables: (d?.payables?.suppliers ?? []) as any[] };
    },
    enabled: reportType === 'outstanding',
  });
  const inventory = useQuery({ queryKey: ['report-inventory'], queryFn: () => api.reports.getInventoryAging(), select: r => (r.data.data || []) as any[], enabled: reportType === 'inventory' });

  const active = { sales, purchases, expenses, outstanding, inventory }[reportType];
  const usesPeriod = ['sales', 'purchases', 'expenses'].includes(reportType);

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" subtitle="How the business is doing, in plain numbers" />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {REPORTS.map(r => (
          <button key={r.key} onClick={() => setReportType(r.key)} className={cn('p-4 rounded-xl border-2 text-left transition', reportType === r.key ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-orange-300')}>
            <r.icon className={cn('w-5 h-5 mb-2', reportType === r.key ? 'text-orange-600' : 'text-gray-400')} />
            <p className={cn('text-sm font-semibold', reportType === r.key ? 'text-orange-700' : 'text-gray-700 dark:text-gray-300')}>{r.label}</p>
            <p className="text-xs text-gray-400 mt-0.5 hidden md:block">{r.description}</p>
          </button>
        ))}
      </div>

      {usesPeriod && (
        <div className="flex flex-wrap gap-2">
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)} className={cn('px-3 py-1.5 rounded-full text-sm border transition', period === p.key ? 'bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-400')}>
              {p.label}
            </button>
          ))}
        </div>
      )}

      {active.isLoading && <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>}
      {active.isError && <Card className="p-6 text-center text-sm text-red-600">This report could not be loaded. Please try again.</Card>}

      {reportType === 'sales' && sales.data && (() => {
        const s = sales.data.summary ?? {};
        const count = num(s._count?.id);
        const total = num(s._sum?.totalAmount);
        // Returns (credit notes) in the period come off sales and GST; bills keep their original amounts.
        const returned = num(sales.data.returns?.total);
        const gst = num(s._sum?.taxAmount) - num(sales.data.returns?.tax);
        return (
          <div className="space-y-4">
            {snapshots.data && <SalesUpdates snapshots={snapshots.data} />}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label={`Sales ${periodLabel}`} value={formatCurrency(total - returned)} sub={`${plural(count, 'bill')}${returned > 0 ? ` · ${formatCurrency(returned)} returned` : ''}`} />
              <Stat label="Average bill" value={formatCurrency(count ? total / count : 0)} />
              <Stat label="Collected" value={formatCurrency(num(s._sum?.paidAmount))} tone="good" />
              <Stat label="Still to collect" value={formatCurrency(num(s._sum?.balanceAmount))} tone={num(s._sum?.balanceAmount) > 0 ? 'bad' : undefined} />
            </div>
            {(gst > 0 || num(s._sum?.discountAmount) > 0) && (
              <p className="text-sm text-gray-500">Includes {formatCurrency(gst)} GST{num(s._sum?.discountAmount) > 0 && ` · ${formatCurrency(num(s._sum?.discountAmount))} given as discount`}.</p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <RankedList
                title="Best-selling items"
                empty="No items sold in this period."
                rows={(sales.data.topProducts || []).map((p: any) => ({ key: p.productId ?? p.product?.name, label: p.product?.name || 'Item', sub: `${num(p._sum?.quantity)} sold`, value: num(p._sum?.amount) }))}
              />
              <RankedList
                title="Top customers"
                empty="No sales in this period."
                rows={(sales.data.topCustomers || []).map((c: any) => ({ key: c.customerId ?? 'walk-in', label: c.customer?.name || 'Walk-in customers', value: num(c._sum?.totalAmount) }))}
              />
            </div>
          </div>
        );
      })()}

      {reportType === 'purchases' && purchases.data && (() => {
        const s = purchases.data.summary ?? {};
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label={`Bought ${periodLabel}`} value={formatCurrency(num(s._sum?.totalAmount))} sub={plural(num(s._count?.id), 'purchase bill')} />
              <Stat label="GST paid on purchases" value={formatCurrency(num(s._sum?.taxAmount))} sub="You can usually claim this back" />
              <Stat label="Paid to suppliers" value={formatCurrency(num(s._sum?.paidAmount))} tone="good" />
              <Stat label="Still to pay" value={formatCurrency(num(s._sum?.balanceAmount))} tone={num(s._sum?.balanceAmount) > 0 ? 'bad' : undefined} />
            </div>
            <RankedList
              title="Suppliers you bought from most"
              empty="No purchases in this period."
              rows={(purchases.data.topSuppliers || []).map((t: any) => ({ key: t.supplierId, label: t.supplier?.name || 'Supplier', value: num(t._sum?.totalAmount) }))}
            />
          </div>
        );
      })()}

      {reportType === 'outstanding' && outstanding.data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <PartyTable title="Customers owe you" rows={outstanding.data.receivables} empty="Nobody owes you money right now" tone="text-red-600" />
          <PartyTable title="You owe suppliers" rows={outstanding.data.payables} empty="You don't owe any supplier right now" tone="text-orange-600" />
        </div>
      )}

      {reportType === 'expenses' && expenses.data && (() => {
        const s = expenses.data.summary ?? {};
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:max-w-xl">
              <Stat label={`Spent ${periodLabel}`} value={formatCurrency(num(s._sum?.amount))} sub={plural(num(s._count?.id), 'expense')} />
            </div>
            <RankedList
              title="By category"
              empty="No expenses in this period."
              rows={(expenses.data.byCategory || []).map((c: any) => ({ key: c.categoryId ?? 'none', label: c.category?.name || 'No category', sub: plural(num(c._count?.id), 'entry', 'entries'), value: num(c._sum?.amount) }))}
            />
            <Link href="/expenses" className="inline-block text-sm text-orange-600 hover:underline">See every expense →</Link>
          </div>
        );
      })()}

      {reportType === 'inventory' && inventory.data && (() => {
        const items = inventory.data.filter(p => p.trackInventory !== false && p.type !== 'SERVICE');
        const value = items.reduce((s, p) => s + num(p.stockValue), 0);
        const low = items.filter(p => num(p.reorderPoint) > 0 && num(p.openingStock) <= num(p.reorderPoint));
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <Stat label="Stock value (at cost)" value={formatCurrency(value)} sub={plural(items.length, 'item')} />
              <Stat label="Running low" value={String(low.length)} sub={low.length ? 'Time to reorder' : 'All good'} tone={low.length ? 'bad' : undefined} />
            </div>
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 uppercase">
                      <th className="text-left px-4 py-3">Item</th>
                      <th className="text-right px-4 py-3">In stock</th>
                      <th className="text-right px-4 py-3">Value</th>
                      <th className="text-right px-4 py-3">Last sold</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(p => {
                      const stock = num(p.openingStock);
                      const isLow = num(p.reorderPoint) > 0 && stock <= num(p.reorderPoint);
                      return (
                        <tr key={p.id} className="border-b border-gray-100 dark:border-gray-700 last:border-0">
                          <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">{p.name}{isLow && <span className="ml-2 text-xs font-medium text-red-600">Low</span>}</td>
                          <td className={cn('px-4 py-2.5 text-right', isLow || stock < 0 ? 'text-red-600 font-semibold' : '')}>{stock}</td>
                          <td className="px-4 py-2.5 text-right">{formatCurrency(num(p.stockValue))}</td>
                          <td className="px-4 py-2.5 text-right text-gray-500">
                            {p.daysSinceLastSale == null ? 'Never' : p.daysSinceLastSale === 0 ? 'Today' : `${plural(p.daysSinceLastSale, 'day')} ago`}
                          </td>
                        </tr>
                      );
                    })}
                    {!items.length && <tr><td colSpan={4} className="text-center py-8 text-gray-500">No stock items yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
            <p className="text-xs text-gray-400">Items that haven’t sold in a long time are listed first. That stock is tying up money.</p>
          </div>
        );
      })()}
    </div>
  );
}
