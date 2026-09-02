'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PageHeader, Button, Card, StatusBadge, EmptyState } from '@/components/shared';
import { ArrowRight, CheckCircle, X } from 'lucide-react';

export default function SalesOrdersPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['sales-orders', statusFilter], queryFn: () => api.salesOrders.list({ status: statusFilter || undefined }), select: r => r.data.data });

  const confirmMut = useMutation({
    mutationFn: (id: string) => api.salesOrders.convertToInvoice(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales-orders'] }); toast.success('Order confirmed & converted to invoice'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.salesOrders.cancel(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales-orders'] }); toast.success('Order cancelled'); },
  });

  const inputCls = "px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none";

  return (
    <div className="space-y-6">
      <PageHeader title="Sales Orders" subtitle={`${data?.total || 0} orders`} />

      {/* Filters */}
      <Card className="p-4">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={`${inputCls} w-48`}>
          <option value="">All Status</option>
          {['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'DELIVERED', 'CANCELLED'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>{['Order#', 'Customer', 'Date', 'Delivery Date', 'Amount', 'Status', 'Actions'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {isLoading && <tr><td colSpan={7} className="text-center py-8 text-gray-500">Loading...</td></tr>}
              {(data?.orders || data?.salesOrders || []).map((o: any) => (
                <tr key={o.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-3 font-mono text-sm font-medium text-orange-600">{o.orderNumber || o.soNumber}</td>
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{o.customer?.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{formatDate(o.orderDate || o.date)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{o.deliveryDate ? formatDate(o.deliveryDate) : '—'}</td>
                  <td className="px-4 py-3 text-sm font-semibold">{formatCurrency(o.total || o.grandTotal)}</td>
                  <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {o.status !== 'CANCELLED' && o.status !== 'DELIVERED' && (
                        <button onClick={() => confirmMut.mutate(o.id)} className="text-xs px-2 py-1 bg-green-50 text-green-600 rounded hover:bg-green-100 flex items-center gap-1"><ArrowRight className="w-3 h-3" /> Invoice</button>
                      )}
                      {o.status === 'DRAFT' && (
                        <button onClick={() => { if (confirm('Cancel order?')) cancelMut.mutate(o.id); }} className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100 flex items-center gap-1"><X className="w-3 h-3" /> Cancel</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!isLoading && !(data?.orders || data?.salesOrders)?.length && (
                <tr><td colSpan={7} className="text-center py-8"><EmptyState title="No sales orders" description="Sales orders from quotations will appear here" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
