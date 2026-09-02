'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PageHeader, Button, Card, StatusBadge, EmptyState } from '@/components/shared';
import { Plus, X, FileText, Send, ArrowRight } from 'lucide-react';
import { useMutation as useMut } from '@tanstack/react-query';

const QuotationSchema = z.object({
  customerId: z.string().min(1, 'Customer required'),
  date: z.string().min(1, 'Required'),
  validUntil: z.string().min(1, 'Required'),
  notes: z.string().optional(),
  items: z.array(z.object({
    description: z.string().min(1, 'Required'),
    quantity: z.number().min(1),
    unitPrice: z.number().min(0),
    taxRate: z.number().default(18),
  })).min(1),
});

type QuotationForm = z.infer<typeof QuotationSchema>;

export default function QuotationsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['quotations', statusFilter], queryFn: () => api.quotations.list({ status: statusFilter || undefined }), select: r => r.data.data });
  const { data: customers } = useQuery({ queryKey: ['customers-all'], queryFn: () => api.customers.list({ limit: 500 }), select: r => r.data.data?.customers });

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<QuotationForm>({
    resolver: zodResolver(QuotationSchema),
    defaultValues: { date: new Date().toISOString().split('T')[0], validUntil: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0], items: [{ description: '', quantity: 1, unitPrice: 0, taxRate: 18 }] },
  });

  const items = watch('items');

  const createMut = useMutation({
    mutationFn: (d: QuotationForm) => api.quotations.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quotations'] }); toast.success('Quotation created'); setShowForm(false); reset(); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const sendMut = useMutation({
    mutationFn: (id: string) => api.quotations.send(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quotations'] }); toast.success('Quotation sent'); },
  });

  const convertMut = useMutation({
    mutationFn: (id: string) => api.quotations.convertToInvoice(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quotations'] }); toast.success('Converted to invoice'); },
  });

  const inputCls = "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none";

  const total = items?.reduce((s: number, i: any) => s + (i.quantity || 0) * (i.unitPrice || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Quotations" subtitle={`${data?.total || 0} quotations`} actions={<Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Create Quotation</Button>} />

      {/* Filters */}
      <Card className="p-4">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={`${inputCls} w-48`}>
          <option value="">All Status</option>
          {['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>{['Quotation#', 'Customer', 'Date', 'Valid Until', 'Amount', 'Status', 'Actions'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {isLoading && <tr><td colSpan={7} className="text-center py-8 text-gray-500">Loading...</td></tr>}
              {(data?.quotations || []).map((q: any) => (
                <tr key={q.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-3 font-mono text-sm font-medium text-orange-600">{q.quotationNumber}</td>
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{q.customer?.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{formatDate(q.date)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{formatDate(q.validUntil)}</td>
                  <td className="px-4 py-3 text-sm font-semibold">{formatCurrency(q.total)}</td>
                  <td className="px-4 py-3"><StatusBadge status={q.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {q.status === 'DRAFT' && <button onClick={() => sendMut.mutate(q.id)} className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 flex items-center gap-1"><Send className="w-3 h-3" /> Send</button>}
                      {(q.status === 'SENT' || q.status === 'ACCEPTED') && <button onClick={() => convertMut.mutate(q.id)} className="text-xs px-2 py-1 bg-green-50 text-green-600 rounded hover:bg-green-100 flex items-center gap-1"><ArrowRight className="w-3 h-3" /> Convert</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!isLoading && !data?.quotations?.length && <tr><td colSpan={7} className="text-center py-8"><EmptyState title="No quotations" description="Create your first quotation" /></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Create Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Create Quotation</h2>
              <button onClick={() => { setShowForm(false); reset(); }}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleSubmit(d => createMut.mutate(d))} className="p-6 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-3"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Customer *</label>
                  <select {...register('customerId')} className={inputCls}><option value="">Select customer</option>{(customers || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                </div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label><input type="date" {...register('date')} className={inputCls} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valid Until</label><input type="date" {...register('validUntil')} className={inputCls} /></div>
              </div>

              {/* Items */}
              <div>
                <div className="flex justify-between items-center mb-2"><label className="text-sm font-medium text-gray-700 dark:text-gray-300">Items</label>
                  <button type="button" onClick={() => setValue('items', [...items, { description: '', quantity: 1, unitPrice: 0, taxRate: 18 }])} className="text-xs text-orange-600 hover:text-orange-700">+ Add Item</button>
                </div>
                {items?.map((item: any, i: number) => (
                  <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-center">
                    <div className="col-span-5"><input {...register(`items.${i}.description`)} className={inputCls} placeholder="Description" /></div>
                    <div className="col-span-2"><input type="number" {...register(`items.${i}.quantity`, { valueAsNumber: true })} className={inputCls} placeholder="Qty" /></div>
                    <div className="col-span-2"><input type="number" step="0.01" {...register(`items.${i}.unitPrice`, { valueAsNumber: true })} className={inputCls} placeholder="Price" /></div>
                    <div className="col-span-2"><select {...register(`items.${i}.taxRate`, { valueAsNumber: true })} className={inputCls}>{[0, 5, 12, 18, 28].map(r => <option key={r} value={r}>{r}%</option>)}</select></div>
                    <button type="button" onClick={() => setValue('items', items.filter((_: any, j: number) => j !== i))} className="text-red-500 text-xs">✕</button>
                  </div>
                ))}
                <div className="text-right text-sm font-semibold text-gray-900 dark:text-white mt-2">Total: {formatCurrency(total)}</div>
              </div>

              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label><textarea {...register('notes')} rows={2} className={inputCls} /></div>
              <div className="flex gap-3 justify-end">
                <Button variant="secondary" type="button" onClick={() => { setShowForm(false); reset(); }}>Cancel</Button>
                <Button type="submit" loading={createMut.isPending}><FileText className="w-4 h-4" /> Create Quotation</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
