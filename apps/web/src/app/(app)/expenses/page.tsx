'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PageHeader, Button, Card, EmptyState, StatusBadge } from '@/components/shared';
import { Plus, X, TrendingUp, TrendingDown } from 'lucide-react';

const ExpenseSchema = z.object({
  description: z.string().min(1, 'Description required'),
  amount: z.coerce.number().min(0.01),
  date: z.string().min(1),
  categoryId: z.string().optional(),
  paymentMode: z.enum(['CASH', 'BANK', 'UPI', 'CHEQUE', 'CREDIT_CARD']),
  taxable: z.boolean().default(false),
  gstRate: z.coerce.number().default(0),
  notes: z.string().optional(),
});

type ExpenseForm = z.infer<typeof ExpenseSchema>;

export default function ExpensesPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({ queryKey: ['expenses', page], queryFn: () => api.expenses.list({ page, limit: 20 }), select: r => r.data.data });
  const { data: categories } = useQuery({ queryKey: ['expense-categories'], queryFn: () => api.expenses.listCategories(), select: r => r.data.data?.categories || [] });

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<ExpenseForm>({ resolver: zodResolver(ExpenseSchema), defaultValues: { paymentMode: 'CASH', date: new Date().toISOString().split('T')[0], taxable: false, gstRate: 0 } });
  const taxable = watch('taxable');

  const createMut = useMutation({
    mutationFn: (d: ExpenseForm) => api.expenses.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); toast.success('Expense recorded'); setShowForm(false); reset(); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.expenses.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); toast.success('Deleted'); },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Expenses" subtitle={`${data?.total || 0} expenses this period`}
        actions={<Button size="sm" onClick={() => { reset({ paymentMode: 'CASH', date: new Date().toISOString().split('T')[0], taxable: false, gstRate: 0 }); setShowForm(true); }}><Plus className="w-4 h-4" /> Add Expense</Button>}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5"><p className="text-sm text-gray-500">This Month</p><p className="text-2xl font-bold text-red-600 mt-1">{formatCurrency(data?.thisMonthTotal || 0)}</p></Card>
        <Card className="p-5"><p className="text-sm text-gray-500">Last Month</p><p className="text-2xl font-bold text-gray-700 dark:text-gray-300 mt-1">{formatCurrency(data?.lastMonthTotal || 0)}</p></Card>
        <Card className="p-5"><p className="text-sm text-gray-500">Total GST (ITC)</p><p className="text-2xl font-bold text-blue-600 mt-1">{formatCurrency(data?.totalGST || 0)}</p></Card>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-gray-200 dark:border-gray-700">{['Date', 'Description', 'Category', 'Mode', 'GST', 'Amount', 'Actions'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}</tr></thead>
            <tbody>
              {isLoading && Array(6).fill(0).map((_, i) => <tr key={i}><td colSpan={7}><div className="h-10 bg-gray-100 dark:bg-gray-700 animate-pulse m-3 rounded" /></td></tr>)}
              {!isLoading && data?.expenses?.map((e: any) => (
                <tr key={e.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3 text-sm text-gray-500">{formatDate(e.date)}</td>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{e.description}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{e.category?.name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{e.paymentMode}</td>
                  <td className="px-4 py-3 text-sm">{e.taxable ? `${e.gstRate}%` : '-'}</td>
                  <td className="px-4 py-3 font-semibold">{formatCurrency(e.amount)}</td>
                  <td className="px-4 py-3"><Button variant="ghost" size="sm" onClick={() => { if (confirm('Delete?')) deleteMut.mutate(e.id); }} className="text-red-500">Delete</Button></td>
                </tr>
              ))}
              {!isLoading && !data?.expenses?.length && <tr><td colSpan={7}><EmptyState title="No expenses" description="Record your business expenses" action={<Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Add Expense</Button>} /></td></tr>}
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
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Add Expense</h2>
              <button onClick={() => { setShowForm(false); reset(); }}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleSubmit(d => createMut.mutate(d))} className="p-6 space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description *</label><input {...register('description')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount *</label><input {...register('amount')} type="number" step="0.01" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label><input {...register('date')} type="date" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label><select {...register('categoryId')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"><option value="">No category</option>{(categories || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Mode</label><select {...register('paymentMode')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none">{['CASH', 'BANK', 'UPI', 'CHEQUE', 'CREDIT_CARD'].map(m => <option key={m}>{m}</option>)}</select></div>
              </div>
              <div className="flex items-center gap-3">
                <input {...register('taxable')} id="taxable" type="checkbox" className="w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500" />
                <label htmlFor="taxable" className="text-sm font-medium text-gray-700 dark:text-gray-300">Has GST (for ITC)</label>
                {taxable && <select {...register('gstRate')} className="ml-2 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700">{[5,12,18,28].map(r => <option key={r} value={r}>{r}%</option>)}</select>}
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <Button variant="secondary" type="button" onClick={() => { setShowForm(false); reset(); }}>Cancel</Button>
                <Button type="submit" loading={createMut.isPending}>Add Expense</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
