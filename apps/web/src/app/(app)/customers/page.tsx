'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { PageHeader, Button, Card, EmptyState, StatusBadge } from '@/components/shared';
import { Plus, Search, Filter, Download, Phone, Mail, MapPin, X, ChevronDown, Edit2, Trash2, Eye } from 'lucide-react';
import Link from 'next/link';

const CustomerSchema = z.object({
  name: z.string().min(1, 'Name required'),
  email: z.string().email().optional().or(z.literal('')),
  mobile: z.string().optional(),
  gstin: z.string().optional(),
  pan: z.string().optional(),
  customerType: z.enum(['RETAIL', 'WHOLESALE', 'B2B', 'B2C', 'EXPORT']).default('RETAIL'),
  creditLimit: z.coerce.number().min(0).default(0),
  creditDays: z.coerce.number().min(0).default(30),
  openingBalance: z.coerce.number().default(0),
  billingAddress: z.object({
    line1: z.string().optional(), city: z.string().optional(), state: z.string().optional(), pincode: z.string().optional(),
  }).optional(),
});

type CustomerForm = z.infer<typeof CustomerSchema>;

export default function CustomersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['customers', search, page],
    queryFn: () => api.customers.list({ search, page, limit: 20 }),
    select: r => r.data.data,
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CustomerForm>({ resolver: zodResolver(CustomerSchema) });

  const createMut = useMutation({
    mutationFn: (d: CustomerForm) => editId ? api.customers.update(editId, d) : api.customers.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); toast.success(editId ? 'Customer updated' : 'Customer created'); setShowForm(false); reset(); setEditId(null); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.customers.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); toast.success('Customer deleted'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Cannot delete customer with invoices'),
  });

  const openCreate = () => { reset({ customerType: 'RETAIL', creditLimit: 0, creditDays: 30, openingBalance: 0 }); setEditId(null); setShowForm(true); };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        subtitle={`${data?.total || 0} customers total`}
        actions={
          <div className="flex gap-3">
            <Button variant="secondary" size="sm"><Download className="w-4 h-4" /> Export</Button>
            <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4" /> Add Customer</Button>
          </div>
        }
      />

      {/* Filters */}
      <Card className="p-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-orange-500 outline-none" placeholder="Search by name, mobile, GSTIN..." />
          </div>
          <Button variant="secondary" size="sm"><Filter className="w-4 h-4" /> Filter</Button>
        </div>
      </Card>

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                {['Name', 'Contact', 'Type', 'Outstanding', 'Credit Limit', 'Actions'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && Array(8).fill(0).map((_, i) => (
                <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-5 bg-gray-100 dark:bg-gray-700 animate-pulse rounded" /></td></tr>
              ))}
              {!isLoading && data?.customers?.map((c: any) => (
                <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                  <td className="px-4 py-3">
                    <Link href={`/customers/${c.id}`} className="font-medium text-gray-900 dark:text-white hover:text-orange-600">{c.name}</Link>
                    {c.gstin && <p className="text-xs text-gray-400">{c.gstin}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-0.5">
                      {c.mobile && <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1"><Phone className="w-3 h-3" />{c.mobile}</p>}
                      {c.email && <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1"><Mail className="w-3 h-3" />{c.email}</p>}
                    </div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={c.customerType || 'RETAIL'} /></td>
                  <td className="px-4 py-3 font-semibold text-sm">{formatCurrency(c.outstandingAmount || 0)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{formatCurrency(c.creditLimit || 0)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Link href={`/customers/${c.id}`}><Button variant="ghost" size="sm"><Eye className="w-4 h-4" /></Button></Link>
                      <Button variant="ghost" size="sm" onClick={() => { setEditId(c.id); reset(c); setShowForm(true); }}><Edit2 className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => { if (confirm('Delete this customer?')) deleteMut.mutate(c.id); }}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!isLoading && !data?.customers?.length && (
                <tr><td colSpan={6}><EmptyState title="No customers yet" description="Add your first customer to start creating invoices" action={<Button onClick={openCreate}><Plus className="w-4 h-4" /> Add Customer</Button>} /></td></tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        {data?.total > 20 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500">Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, data.total)} of {data.total}</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={page * 20 >= data.total} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{editId ? 'Edit Customer' : 'Add Customer'}</h2>
              <button onClick={() => { setShowForm(false); setEditId(null); reset(); }}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleSubmit(d => createMut.mutate(d))} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="label">Business/Customer Name *</label>
                  <input {...register('name')} className="input" placeholder="ABC Traders" />
                  {errors.name && <p className="err">{errors.name.message}</p>}
                </div>
                <div>
                  <label className="label">Mobile</label>
                  <input {...register('mobile')} className="input" placeholder="9876543210" />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input {...register('email')} type="email" className="input" placeholder="abc@example.com" />
                </div>
                <div>
                  <label className="label">GSTIN</label>
                  <input {...register('gstin')} className="input uppercase" placeholder="22AAAAA0000A1Z5" maxLength={15} />
                </div>
                <div>
                  <label className="label">PAN</label>
                  <input {...register('pan')} className="input uppercase" placeholder="AAAAA0000A" maxLength={10} />
                </div>
                <div>
                  <label className="label">Customer Type</label>
                  <select {...register('customerType')} className="input">
                    {['RETAIL', 'WHOLESALE', 'B2B', 'B2C', 'EXPORT'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Opening Balance (₹)</label>
                  <input {...register('openingBalance')} type="number" className="input" placeholder="0" />
                </div>
                <div>
                  <label className="label">Credit Limit (₹)</label>
                  <input {...register('creditLimit')} type="number" className="input" placeholder="0" />
                </div>
                <div>
                  <label className="label">Credit Days</label>
                  <input {...register('creditDays')} type="number" className="input" placeholder="30" />
                </div>
              </div>

              <details className="border border-gray-200 dark:border-gray-600 rounded-lg">
                <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300">Billing Address (optional)</summary>
                <div className="p-4 grid grid-cols-2 gap-3">
                  <div className="col-span-2"><input {...register('billingAddress.line1')} className="input" placeholder="Address Line 1" /></div>
                  <input {...register('billingAddress.city')} className="input" placeholder="City" />
                  <input {...register('billingAddress.state')} className="input" placeholder="State" />
                  <input {...register('billingAddress.pincode')} className="input" placeholder="Pincode" />
                </div>
              </details>

              <div className="flex gap-3 justify-end pt-2">
                <Button variant="secondary" type="button" onClick={() => { setShowForm(false); setEditId(null); reset(); }}>Cancel</Button>
                <Button type="submit" loading={createMut.isPending}>{editId ? 'Update' : 'Create'} Customer</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx>{`
        .label { display: block; font-size: 0.875rem; font-weight: 500; color: #6b7280; margin-bottom: 0.25rem; }
        .input { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; border-radius: 0.5rem; font-size: 0.875rem; outline: none; background: white; }
        .input:focus { border-color: #f97316; box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.2); }
        .err { color: #ef4444; font-size: 0.75rem; margin-top: 0.25rem; }
        @media (prefers-color-scheme: dark) { .input { background: #374151; border-color: #4b5563; color: white; } }
      `}</style>
    </div>
  );
}
