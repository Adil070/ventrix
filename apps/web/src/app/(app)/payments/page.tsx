'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import { PageHeader, Button, Card, EmptyState, StatusBadge } from '@/components/shared';
import { Plus, Search, X, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';

const PaymentSchema = z.object({
  type: z.enum(['RECEIPT', 'PAYMENT']),
  customerId: z.string().optional(),
  supplierId: z.string().optional(),
  invoiceId: z.string().optional(),
  amount: z.coerce.number().min(0.01, 'Amount required'),
  paymentMode: z.enum(['CASH', 'BANK', 'UPI', 'CHEQUE', 'NEFT', 'RTGS']),
  paymentDate: z.string().min(1),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
});

type PaymentForm = z.infer<typeof PaymentSchema>;

export default function PaymentsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['payments', search, type, page],
    queryFn: () => api.payments.list({ search, type: type || undefined, page, limit: 20 }),
    select: r => r.data.data,
  });

  const { data: customers } = useQuery({ queryKey: ['customers-simple'], queryFn: () => api.customers.list({ limit: 200 }), select: r => r.data.data?.customers || [] });
  const { data: suppliers } = useQuery({ queryKey: ['suppliers-simple'], queryFn: () => api.suppliers.list({ limit: 200 }), select: r => r.data.data?.suppliers || [] });

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<PaymentForm>({ resolver: zodResolver(PaymentSchema), defaultValues: { type: 'RECEIPT', paymentMode: 'CASH', paymentDate: new Date().toISOString().split('T')[0] } });
  const paymentType = watch('type');

  const createMut = useMutation({
    mutationFn: (d: PaymentForm) => api.payments.record(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payments'] }); toast.success('Payment recorded'); setShowForm(false); reset(); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Payments" subtitle={`${data?.total || 0} transactions`}
        actions={<Button size="sm" onClick={() => { reset({ type: 'RECEIPT', paymentMode: 'CASH', paymentDate: new Date().toISOString().split('T')[0] }); setShowForm(true); }}><Plus className="w-4 h-4" /> Record Payment</Button>}
      />

      <Card className="p-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none bg-white dark:bg-gray-700" placeholder="Search payments..." />
          </div>
          <select value={type} onChange={e => setType(e.target.value)} className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-orange-500 outline-none">
            <option value="">All Types</option>
            <option value="RECEIPT">Receipts (In)</option>
            <option value="PAYMENT">Payments (Out)</option>
          </select>
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-gray-200 dark:border-gray-700">
              {['Date', 'Type', 'Party', 'Mode', 'Amount', 'Reference'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}
            </tr></thead>
            <tbody>
              {isLoading && Array(6).fill(0).map((_, i) => <tr key={i}><td colSpan={6}><div className="h-10 bg-gray-100 dark:bg-gray-700 animate-pulse m-3 rounded" /></td></tr>)}
              {!isLoading && data?.payments?.map((p: any) => (
                <tr key={p.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                  <td className="px-4 py-3 text-sm text-gray-500">{formatDate(p.paymentDate)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full ${p.type === 'RECEIPT' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                      {p.type === 'RECEIPT' ? <ArrowDownCircle className="w-3 h-3" /> : <ArrowUpCircle className="w-3 h-3" />}
                      {p.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{p.customer?.name || p.supplier?.name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{p.paymentMode}</td>
                  <td className="px-4 py-3 font-semibold text-sm">{formatCurrency(p.amount)}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{p.referenceNumber || '-'}</td>
                </tr>
              ))}
              {!isLoading && !data?.payments?.length && <tr><td colSpan={6}><EmptyState title="No payments" description="Record incoming or outgoing payments" action={<Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Record Payment</Button>} /></td></tr>}
            </tbody>
          </table>
        </div>
        {data?.total > 20 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500">{(page-1)*20+1}–{Math.min(page*20, data.total)} of {data.total}</p>
            <div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous</Button><Button variant="secondary" size="sm" disabled={page*20>=data.total} onClick={()=>setPage(p=>p+1)}>Next</Button></div>
          </div>
        )}
      </Card>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Record Payment</h2>
              <button onClick={() => { setShowForm(false); reset(); }}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleSubmit(d => createMut.mutate(d))} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
                <div className="grid grid-cols-2 gap-3">
                  {(['RECEIPT', 'PAYMENT'] as const).map(t => (
                    <label key={t} className={`flex items-center justify-center gap-2 p-3 border-2 rounded-lg cursor-pointer transition ${paymentType === t ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20 text-orange-700' : 'border-gray-200 dark:border-gray-600'}`}>
                      <input {...register('type')} type="radio" value={t} className="sr-only" />
                      {t === 'RECEIPT' ? <ArrowDownCircle className="w-4 h-4" /> : <ArrowUpCircle className="w-4 h-4" />}
                      <span className="font-medium text-sm">{t === 'RECEIPT' ? 'Money In' : 'Money Out'}</span>
                    </label>
                  ))}
                </div>
              </div>
              {paymentType === 'RECEIPT' && (
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Customer</label>
                  <select {...register('customerId')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 focus:ring-2 focus:ring-orange-500 outline-none">
                    <option value="">Select customer</option>
                    {(customers || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              {paymentType === 'PAYMENT' && (
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Supplier</label>
                  <select {...register('supplierId')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 focus:ring-2 focus:ring-orange-500 outline-none">
                    <option value="">Select supplier</option>
                    {(suppliers || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount *</label><input {...register('amount')} type="number" step="0.01" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label><input {...register('paymentDate')} type="date" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Mode</label>
                  <select {...register('paymentMode')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 focus:ring-2 focus:ring-orange-500 outline-none">{['CASH', 'BANK', 'UPI', 'CHEQUE', 'NEFT', 'RTGS'].map(m => <option key={m}>{m}</option>)}</select>
                </div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reference #</label><input {...register('referenceNumber')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 focus:ring-2 focus:ring-orange-500 outline-none" /></div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <Button variant="secondary" type="button" onClick={() => { setShowForm(false); reset(); }}>Cancel</Button>
                <Button type="submit" loading={createMut.isPending}>Record Payment</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
