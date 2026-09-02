'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PageHeader, Button, Card, EmptyState, StatusBadge } from '@/components/shared';
import { Plus, Search, Download, FileText, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function PurchasesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['purchases', search, page],
    queryFn: () => api.purchases.list({ search, page, limit: 20 }),
    select: r => r.data.data,
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.purchases.cancel(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchases'] }); toast.success('Purchase cancelled'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Purchase Bills" subtitle={`${data?.total || 0} bills`}
        actions={
          <div className="flex gap-3">
            <Button variant="secondary" size="sm"><Download className="w-4 h-4" /> Export</Button>
            <Link href="/purchases/new"><Button size="sm"><Plus className="w-4 h-4" /> Record Purchase</Button></Link>
          </div>
        }
      />

      <Card className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none bg-white dark:bg-gray-700" placeholder="Search purchases..." />
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-gray-200 dark:border-gray-700">
              {['Bill #', 'Supplier', 'Date', 'Total', 'Paid', 'Balance', 'Status', 'Actions'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}
            </tr></thead>
            <tbody>
              {isLoading && Array(6).fill(0).map((_, i) => <tr key={i}><td colSpan={8}><div className="h-10 bg-gray-100 dark:bg-gray-700 animate-pulse m-3 rounded" /></td></tr>)}
              {!isLoading && data?.purchases?.map((p: any) => (
                <tr key={p.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                  <td className="px-4 py-3 font-medium text-orange-600">{p.purchaseNumber}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{p.supplier?.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{formatDate(p.purchaseDate)}</td>
                  <td className="px-4 py-3 font-semibold">{formatCurrency(p.totalAmount)}</td>
                  <td className="px-4 py-3 text-green-600 font-semibold">{formatCurrency(p.paidAmount)}</td>
                  <td className="px-4 py-3 text-red-600 font-semibold">{formatCurrency(p.balanceAmount)}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-3">
                    {p.status !== 'CANCELLED' && (
                      <Button variant="ghost" size="sm" onClick={() => { if (confirm('Cancel this purchase?')) cancelMut.mutate(p.id); }}>Cancel</Button>
                    )}
                  </td>
                </tr>
              ))}
              {!isLoading && !data?.purchases?.length && <tr><td colSpan={8}><EmptyState title="No purchases" description="Record your first purchase bill" action={<Link href="/purchases/new"><Button size="sm"><Plus className="w-4 h-4" /> Record Purchase</Button></Link>} /></td></tr>}
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
