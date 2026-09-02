'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PageHeader, Button, Card, EmptyState, StatusBadge } from '@/components/shared';
import { Plus, Search, Filter, Download, FileText } from 'lucide-react';
import Link from 'next/link';

export default function InvoicesPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', search, status, page],
    queryFn: () => api.invoices.list({ search, status: status || undefined, page, limit: 20 }),
    select: r => r.data.data,
  });

  const statuses = ['', 'DRAFT', 'CONFIRMED', 'PAID', 'PARTIALLY_PAID', 'OVERDUE', 'CANCELLED'];

  const totalOutstanding = data?.invoices?.filter((i: any) => ['CONFIRMED', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.status)).reduce((s: number, i: any) => s + (i.balanceAmount || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Invoices" subtitle={`${data?.total || 0} invoices · Outstanding: ${formatCurrency(totalOutstanding)}`}
        actions={
          <div className="flex gap-3">
            <Button variant="secondary" size="sm"><Download className="w-4 h-4" /> Export</Button>
            <Link href="/billing/invoices/new"><Button size="sm"><Plus className="w-4 h-4" /> Create Invoice</Button></Link>
          </div>
        }
      />

      <Card className="p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none bg-white dark:bg-gray-700" placeholder="Search by invoice number, customer..." />
          </div>
          <select value={status} onChange={e => setStatus(e.target.value)} className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-orange-500 outline-none">
            {statuses.map(s => <option key={s} value={s}>{s || 'All Status'}</option>)}
          </select>
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-gray-200 dark:border-gray-700">
              {['Invoice #', 'Customer', 'Date', 'Due Date', 'Amount', 'Balance', 'Status', 'Actions'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}
            </tr></thead>
            <tbody>
              {isLoading && Array(8).fill(0).map((_, i) => <tr key={i}><td colSpan={8}><div className="h-10 bg-gray-100 dark:bg-gray-700 animate-pulse m-3 rounded" /></td></tr>)}
              {!isLoading && data?.invoices?.map((inv: any) => (
                <tr key={inv.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                  <td className="px-4 py-3">
                    <Link href={`/billing/invoices/${inv.id}`} className="font-medium text-orange-600 hover:text-orange-700">{inv.invoiceNumber}</Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{inv.customer?.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{formatDate(inv.invoiceDate)}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{formatDate(inv.dueDate)}</td>
                  <td className="px-4 py-3 font-semibold">{formatCurrency(inv.totalAmount)}</td>
                  <td className="px-4 py-3 font-semibold text-red-600">{formatCurrency(inv.balanceAmount)}</td>
                  <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Link href={`/billing/invoices/${inv.id}`}><Button variant="ghost" size="sm"><FileText className="w-4 h-4" /></Button></Link>
                    </div>
                  </td>
                </tr>
              ))}
              {!isLoading && !data?.invoices?.length && <tr><td colSpan={8}><EmptyState title="No invoices" description="Create your first invoice" action={<Link href="/billing/invoices/new"><Button size="sm"><Plus className="w-4 h-4" /> Create Invoice</Button></Link>} /></td></tr>}
            </tbody>
          </table>
        </div>
        {data?.total > 20 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500">Showing {(page-1)*20+1}–{Math.min(page*20, data.total)} of {data.total}</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={page*20>=data.total} onClick={()=>setPage(p=>p+1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
