'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Plus, Search, Download } from 'lucide-react';
import api from '@/lib/api';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { BILL_STATUS_TEXT, plural } from '@/lib/business';
import { PageHeader, Button, Card, EmptyState, StatusBadge } from '@/components/shared';

type Period = 'today' | 'week' | 'month' | 'all';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Last 7 days' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All time' },
];
const STATUS_TABS = [
  { key: '', label: 'All' },
  { key: 'CONFIRMED', label: 'Unpaid' },
  { key: 'PARTIALLY_PAID', label: 'Part paid' },
  { key: 'PAID', label: 'Paid' },
];

function periodRange(p: Period) {
  const now = new Date();
  const to = new Date(now); to.setHours(23, 59, 59, 999);
  const from = new Date(now); from.setHours(0, 0, 0, 0);
  if (p === 'week') from.setDate(from.getDate() - 6);
  if (p === 'month') from.setDate(1);
  if (p === 'all') from.setFullYear(2000, 0, 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

const PAGE_SIZE = 20;

export default function SalesPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState<Period>('month');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const range = periodRange(period);
  const filters = {
    search: debounced || undefined,
    status: status || undefined,
    fromDate: range.from,
    toDate: range.to,
    sortBy: 'invoiceDate',
    sortOrder: 'desc',
  };

  // The list endpoint returns rows in `data` and the count in `pagination`.
  const { data, isLoading } = useQuery({
    queryKey: ['invoices', filters, page],
    queryFn: () => api.invoices.list({ ...filters, page, limit: PAGE_SIZE }),
    select: r => ({ rows: (r.data.data || []) as any[], total: Number(r.data.pagination?.total || 0) }),
  });

  const { data: stats } = useQuery({
    queryKey: ['invoices', 'stats', period],
    queryFn: () => api.invoices.stats({ from: range.from, to: range.to }),
    select: r => r.data.data,
  });

  // Same-day bills come back in no particular order; show the latest bill number first.
  const rows = [...(data?.rows ?? [])].sort((a, b) =>
    new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime() || b.invoiceNumber.localeCompare(a.invoiceNumber));
  const total = data?.total ?? 0;
  const periodLabel = PERIODS.find(p => p.key === period)!.label.toLowerCase();

  const exportCsv = async () => {
    try {
      const r = await api.invoices.list({ ...filters, page: 1, limit: 1000 });
      const list: any[] = r.data.data || [];
      const head = ['Bill no.', 'Date', 'Customer', 'Total', 'Paid', 'Balance due', 'Status'];
      const lines = list.map(i => [
        i.invoiceNumber, formatDate(i.invoiceDate), i.customer?.name || 'Walk-in customer',
        Number(i.totalAmount).toFixed(2), Number(i.paidAmount).toFixed(2), Number(i.balanceAmount).toFixed(2),
        BILL_STATUS_TEXT[i.status] ?? i.status,
      ]);
      const csv = [head, ...lines].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url; a.download = `sales-${period}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Could not export');
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sales"
        subtitle="Every bill you’ve given to customers"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={exportCsv}><Download className="w-4 h-4" /> Export</Button>
            <Link href="/billing/invoices/new"><Button size="sm"><Plus className="w-4 h-4" /> New sale</Button></Link>
          </div>
        }
      />

      {/* Period + summary */}
      <div className="flex flex-wrap gap-2">
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => { setPeriod(p.key); setPage(1); }}
            className={cn('px-3 py-1.5 rounded-full text-sm border transition', period === p.key ? 'bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-400')}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="text-sm text-gray-500">Sales {periodLabel === 'all time' ? 'so far' : periodLabel}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{formatCurrency(stats?.totalRevenue || 0)}</p>
          <p className="text-xs text-gray-400">{plural(stats?.invoiceCount || 0, 'bill')}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Money collected</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{formatCurrency(stats?.totalPaid || 0)}</p>
          <p className="text-xs text-gray-400">{plural(stats?.paidCount || 0, 'bill')} fully paid</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Still to collect</p>
          <p className={cn('text-2xl font-bold mt-1', (stats?.totalOutstanding || 0) > 0 ? 'text-red-600' : 'text-gray-900 dark:text-white')}>{formatCurrency(stats?.totalOutstanding || 0)}</p>
          <Link href="/reports?type=outstanding" className="text-xs text-orange-600 hover:underline">See who owes you →</Link>
        </Card>
      </div>

      <Card className="p-3">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none bg-white dark:bg-gray-700" placeholder="Search by bill number or customer name…" />
          </div>
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
            {STATUS_TABS.map(t => (
              <button key={t.key} onClick={() => { setStatus(t.key); setPage(1); }}
                className={cn('px-3 py-1.5 rounded-md text-sm font-medium transition', status === t.key ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-gray-200 dark:border-gray-700">
              {['Bill no.', 'Customer', 'Date', 'Total', 'Balance due', 'Status'].map(h => (
                <th key={h} className={cn('text-xs font-semibold text-gray-500 uppercase px-4 py-3', ['Total', 'Balance due'].includes(h) ? 'text-right' : 'text-left')}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {isLoading && Array(6).fill(0).map((_, i) => <tr key={i}><td colSpan={6}><div className="h-10 bg-gray-100 dark:bg-gray-700 animate-pulse m-3 rounded" /></td></tr>)}
              {!isLoading && rows.map(inv => {
                const balance = Number(inv.balanceAmount || 0);
                return (
                  <tr key={inv.id} onClick={() => router.push(`/billing/invoices/${inv.id}`)} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition cursor-pointer">
                    <td className="px-4 py-3 font-medium text-orange-600">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{inv.customer?.name || <span className="text-gray-500">Walk-in customer</span>}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDate(inv.invoiceDate)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatCurrency(inv.totalAmount)}</td>
                    <td className={cn('px-4 py-3 text-right font-semibold', balance > 0 ? 'text-red-600' : 'text-gray-400 font-normal')}>{balance > 0 ? formatCurrency(balance) : '-'}</td>
                    <td className="px-4 py-3"><StatusBadge status={inv.status} label={BILL_STATUS_TEXT[inv.status]} /></td>
                  </tr>
                );
              })}
              {!isLoading && !rows.length && (
                <tr><td colSpan={6}>
                  <EmptyState
                    title={debounced || status ? 'No bills match' : `No sales ${periodLabel === 'all time' ? 'yet' : periodLabel}`}
                    description={debounced || status ? 'Try a different search or filter.' : 'Bills you make will show up here.'}
                    action={!debounced && !status && <Link href="/billing/invoices/new"><Button size="sm"><Plus className="w-4 h-4" /> New sale</Button></Link>}
                  />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500">Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={page * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
