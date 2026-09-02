'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { PageHeader, Button, Card, EmptyState, StatusBadge } from '@/components/shared';
import { Plus, Search, X, Edit2, Trash2, Eye, Download } from 'lucide-react';
import Link from 'next/link';

const SupplierSchema = z.object({
  name: z.string().min(1, 'Name required'),
  email: z.string().email().optional().or(z.literal('')),
  mobile: z.string().optional(),
  gstin: z.string().optional(),
  pan: z.string().optional(),
  openingBalance: z.coerce.number().default(0),
  creditDays: z.coerce.number().min(0).default(30),
});

type SupplierForm = z.infer<typeof SupplierSchema>;

export default function SuppliersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', search, page],
    queryFn: () => api.suppliers.list({ search, page, limit: 20 }),
    select: r => r.data.data,
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<SupplierForm>({ resolver: zodResolver(SupplierSchema) });

  const saveMut = useMutation({
    mutationFn: (d: SupplierForm) => editId ? api.suppliers.update(editId, d) : api.suppliers.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); toast.success(editId ? 'Supplier updated' : 'Supplier created'); setShowForm(false); reset(); setEditId(null); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.suppliers.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); toast.success('Supplier deleted'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Suppliers" subtitle={`${data?.total || 0} suppliers`}
        actions={<div className="flex gap-3"><Button variant="secondary" size="sm"><Download className="w-4 h-4" /> Export</Button><Button size="sm" onClick={() => { reset({ creditDays: 30, openingBalance: 0 }); setEditId(null); setShowForm(true); }}><Plus className="w-4 h-4" /> Add Supplier</Button></div>}
      />

      <Card className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-orange-500 outline-none" placeholder="Search suppliers..." />
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-gray-200 dark:border-gray-700">
              {['Name', 'Contact', 'GSTIN', 'Outstanding', 'Actions'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}
            </tr></thead>
            <tbody>
              {isLoading && Array(6).fill(0).map((_, i) => <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-5 bg-gray-100 dark:bg-gray-700 animate-pulse rounded" /></td></tr>)}
              {!isLoading && data?.suppliers?.map((s: any) => (
                <tr key={s.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{s.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{s.mobile}{s.email && ` · ${s.email}`}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{s.gstin || '-'}</td>
                  <td className="px-4 py-3 font-semibold">{formatCurrency(s.outstandingAmount || 0)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => { setEditId(s.id); reset(s); setShowForm(true); }}><Edit2 className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => { if (confirm('Delete?')) deleteMut.mutate(s.id); }}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!isLoading && !data?.suppliers?.length && <tr><td colSpan={5}><EmptyState title="No suppliers yet" description="Add your first supplier" action={<Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Add Supplier</Button>} /></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{editId ? 'Edit' : 'Add'} Supplier</h2>
              <button onClick={() => { setShowForm(false); setEditId(null); reset(); }}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleSubmit(d => saveMut.mutate(d))} className="p-6 space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
                <input {...register('name')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" />
                {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mobile</label><input {...register('mobile')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label><input {...register('email')} type="email" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">GSTIN</label><input {...register('gstin')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white uppercase focus:ring-2 focus:ring-orange-500 outline-none" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Opening Balance</label><input {...register('openingBalance')} type="number" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <Button variant="secondary" type="button" onClick={() => { setShowForm(false); reset(); }}>Cancel</Button>
                <Button type="submit" loading={saveMut.isPending}>{editId ? 'Update' : 'Create'} Supplier</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
