'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PageHeader, Button, Card, StatusBadge, EmptyState } from '@/components/shared';
import { ArrowRight, X } from 'lucide-react';

// Values of the API's SalesOrderStatus enum (any other value makes GET /sales-orders fail).
const ORDER_STATUSES: { value: string; label: string }[] = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'PARTIALLY_FULFILLED', label: 'Partly delivered' },
  { value: 'FULFILLED', label: 'Delivered' },
  { value: 'INVOICED', label: 'Invoiced' },
  { value: 'CANCELLED', label: 'Cancelled' },
];
const statusLabel = (s: string) => ORDER_STATUSES.find(o => o.value === s)?.label;

const apiError = (e: any, fallback: string) => {
  const d = e?.response?.data;
  const detail = d?.details?.[0] ?? d?.errors?.[0];
  return detail ? `${detail.field}: ${detail.message}` : d?.message || d?.error || fallback;
};

export default function SalesOrdersPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');

  // GET /sales-orders is paginated: rows are in data (an array), the count is in pagination.total.
  const { data, isLoading } = useQuery({
    queryKey: ['sales-orders', statusFilter],
    queryFn: () => api.salesOrders.list({ status: statusFilter || undefined, limit: 100 }),
    select: r => ({ orders: (Array.isArray(r.data.data) ? r.data.data : []) as any[], total: Number(r.data.pagination?.total ?? 0) }),
  });

  const confirmMut = useMutation({
    mutationFn: (id: string) => api.salesOrders.convertToInvoice(id),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      toast.success(r?.data?.data?.invoiceNumber ? `Invoice ${r.data.data.invoiceNumber} created from order` : 'Invoice created from order');
    },
    onError: (e: any) => toast.error(apiError(e, 'Could not create invoice')),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.salesOrders.cancel(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales-orders'] }); toast.success('Order cancelled'); },
    onError: (e: any) => toast.error(apiError(e, 'Could not cancel order')),
  });

  const inputCls = "px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none";

  return (
    <div className="space-y-6">
      <PageHeader title="Sales Orders" subtitle={`${data?.total ?? 0} orders`} />

      {/* Filters */}
      <Card className="p-4">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={`${inputCls} w-48`}>
          <option value="">All Status</option>
          {ORDER_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
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
              {(data?.orders ?? []).map((o: any) => (
                <tr key={o.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-3 font-mono text-sm font-medium text-orange-600">{o.orderNumber}</td>
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{o.customer?.name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{formatDate(o.orderDate)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{o.deliveryDate ? formatDate(o.deliveryDate) : '—'}</td>
                  <td className="px-4 py-3 text-sm font-semibold">{formatCurrency(Number(o.totalAmount ?? 0))}</td>
                  <td className="px-4 py-3"><StatusBadge status={o.status} label={statusLabel(o.status)} /></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {/* INVOICED orders already have an invoice; the API would happily create a second one. */}
                      {o.status !== 'CANCELLED' && o.status !== 'INVOICED' && (
                        <button onClick={() => { if (confirm(`Create an invoice for ${o.orderNumber}?`)) confirmMut.mutate(o.id); }} disabled={confirmMut.isPending} className="text-xs px-2 py-1 bg-green-50 text-green-600 rounded hover:bg-green-100 flex items-center gap-1"><ArrowRight className="w-3 h-3" /> Make invoice</button>
                      )}
                      {/* New orders are created as CONFIRMED, so allow cancelling those too. */}
                      {(o.status === 'DRAFT' || o.status === 'CONFIRMED') && (
                        <button onClick={() => { if (confirm(`Cancel order ${o.orderNumber}?`)) cancelMut.mutate(o.id); }} disabled={cancelMut.isPending} className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100 flex items-center gap-1"><X className="w-3 h-3" /> Cancel</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!isLoading && !data?.orders.length && (
                <tr><td colSpan={7} className="text-center py-8"><EmptyState title="No sales orders" description="Sales orders from quotations will appear here" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
