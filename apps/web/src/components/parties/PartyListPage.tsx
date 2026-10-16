'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Search, X, Edit2, Trash2, Phone, ChevronDown } from 'lucide-react';
import api from '@/lib/api';
import { cn, formatCurrency } from '@/lib/utils';
import { dropEmpty } from '@/lib/business';
import { useDues } from '@/hooks/useDues';
import { useOpenFromUrl } from '@/hooks/useOpenFromUrl';
import { PageHeader, Button, Card, EmptyState } from '@/components/shared';

type Kind = 'customer' | 'supplier';

interface FormState {
  name: string; phone: string; email: string; gstin: string; pan: string;
  openingBalance: string; days: string; line1: string; city: string; state: string; pincode: string;
}

const EMPTY: FormState = { name: '', phone: '', email: '', gstin: '', pan: '', openingBalance: '', days: '', line1: '', city: '', state: '', pincode: '' };

const COPY = {
  customer: {
    title: 'Customers', subtitle: 'People and businesses you sell to',
    add: 'Add customer', owes: 'Owes you', empty: 'No customers yet',
    emptyBody: 'You can also add customers while making a sale: just type their name.',
    opening: 'Amount they already owed you before using Ventrix', days: 'Days they get to pay',
    namePh: 'e.g. Sharma Traders or Ramesh Kumar',
  },
  supplier: {
    title: 'Suppliers', subtitle: 'People and businesses you buy from',
    add: 'Add supplier', owes: 'You owe', empty: 'No suppliers yet',
    emptyBody: 'You can also add suppliers while recording a purchase: just type their name.',
    opening: 'Amount you already owed them before using Ventrix', days: 'Days you get to pay them',
    namePh: 'e.g. Gupta Wholesale',
  },
} as const;

export function PartyListPage({ kind }: { kind: Kind }) {
  const t = COPY[kind];
  const resource = kind === 'customer' ? api.customers : api.suppliers;
  const qc = useQueryClient();
  const dues = useDues(kind);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: [`${kind}s`, search, page],
    queryFn: () => resource.list({ search: search || undefined, page, limit: 20 }),
    select: r => r.data.data,
  });
  const rows: any[] = data?.[`${kind}s`] || [];

  const openCreate = () => { setForm(EMPTY); setEditId(null); setShowMore(false); setError(''); setShowForm(true); };
  useOpenFromUrl(openCreate);

  const openEdit = (p: any) => {
    const a = p.billingAddress || {};
    setForm({
      name: p.name || '', phone: p.phone || p.mobile || '', email: p.email || '', gstin: p.gstin || '', pan: p.pan || '',
      openingBalance: Number(p.openingBalance) ? String(Number(p.openingBalance)) : '',
      days: String(kind === 'customer' ? (p.creditDays ?? '') : (p.paymentTerms ?? '')),
      line1: a.line1 || '', city: a.city || '', state: a.state || '', pincode: a.pincode || '',
    });
    setEditId(p.id); setShowMore(false); setError(''); setShowForm(true);
  };

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = dropEmpty({
        name: form.name.trim(),
        [kind === 'customer' ? 'mobile' : 'phone']: form.phone.trim(),
        email: form.email.trim(),
        gstin: form.gstin.trim().toUpperCase(),
        pan: form.pan.trim().toUpperCase(),
        openingBalance: form.openingBalance ? Number(form.openingBalance) : '',
        [kind === 'customer' ? 'creditDays' : 'paymentTerms']: form.days ? Number(form.days) : '',
        billingAddress: { line1: form.line1, city: form.city, state: form.state, pincode: form.pincode },
      });
      return editId ? resource.update(editId, payload) : resource.create(payload);
    },
    onSuccess: () => {
      [`${kind}s`, `${kind}-picker`, 'dues'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(editId ? 'Saved' : `${form.name} added`);
      setShowForm(false);
    },
    onError: (e: any) => {
      const data = e?.response?.data;
      const field: string | undefined = (data?.details ?? data?.errors)?.[0]?.field;
      const names: Record<string, string> = { mobile: 'mobile number', phone: 'phone number', gstin: 'GSTIN', pan: 'PAN', email: 'email' };
      setError(field ? `Please check the ${names[field] ?? field}.` : e?.response?.data?.message || 'Could not save');
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => resource.delete(id),
    onSuccess: () => { [`${kind}s`, `${kind}-picker`].forEach(k => qc.invalidateQueries({ queryKey: [k] })); toast.success('Deleted'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || `Can't delete a ${kind} who has bills`),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setError('Enter a name.');
    if (kind === 'customer' && form.phone && !/^[6-9]\d{9}$/.test(form.phone.trim())) return setError('Mobile number should be 10 digits, starting with 6–9.');
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email.trim())) return setError('That email address doesn’t look right.');
    setError('');
    saveMut.mutate();
  };

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const inputCls = 'w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none';
  const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';
  const totalDue = Array.from(dues.values()).reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.title}
        subtitle={totalDue > 0 ? `${t.subtitle} · ${t.owes === 'Owes you' ? 'They owe you' : 'You owe them'} ${formatCurrency(totalDue)} in total` : t.subtitle}
        actions={<Button size="sm" onClick={openCreate}><Plus className="w-4 h-4" /> {t.add}</Button>}
      />

      <Card className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-orange-500 outline-none" placeholder="Search by name, phone or GSTIN…" />
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                {['Name', 'Phone', t.owes, ''].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {isLoading && Array(6).fill(0).map((_, i) => <tr key={i}><td colSpan={4} className="px-4 py-3"><div className="h-5 bg-gray-100 dark:bg-gray-700 animate-pulse rounded" /></td></tr>)}
              {!isLoading && rows.map(p => {
                const due = dues.get(p.id) || 0;
                return (
                  <tr key={p.id} onClick={() => openEdit(p)} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition cursor-pointer">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900 dark:text-white">{p.name}</p>
                      {p.gstin && <p className="text-xs text-gray-400">GSTIN {p.gstin}</p>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{p.phone ? <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{p.phone}</span> : '-'}</td>
                    <td className={cn('px-4 py-3 font-semibold text-sm', due > 0 ? (kind === 'customer' ? 'text-red-600' : 'text-gray-900 dark:text-white') : 'text-gray-400')}>
                      {due > 0 ? formatCurrency(due) : 'Nothing'}
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {due > 0 && (
                          <Link href={`/payments?new=${kind === 'customer' ? 'in' : 'out'}`} className="px-2.5 py-1 text-xs font-medium rounded-lg text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20">
                            {kind === 'customer' ? 'Receive' : 'Pay'}
                          </Link>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}><Edit2 className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => { if (confirm(`Delete ${p.name}? This can't be undone.`)) deleteMut.mutate(p.id); }} aria-label={`Delete ${p.name}`}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!isLoading && !rows.length && (
                <tr><td colSpan={4}><EmptyState title={search ? 'No matches' : t.empty} description={search ? 'Try a different name or number.' : t.emptyBody} action={!search && <Button onClick={openCreate}><Plus className="w-4 h-4" /> {t.add}</Button>} /></td></tr>
              )}
            </tbody>
          </table>
        </div>
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

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">{editId ? form.name || 'Edit' : t.add}</h2>
              <button onClick={() => setShowForm(false)} aria-label="Close"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={submit} className="p-5 space-y-4">
              <div><label className={labelCls}>Name</label><input value={form.name} onChange={set('name')} className={inputCls} placeholder={t.namePh} autoFocus /></div>
              <div><label className={labelCls}>{kind === 'customer' ? 'Mobile number' : 'Phone'} <span className="text-gray-400 font-normal">(optional)</span></label><input value={form.phone} onChange={set('phone')} inputMode="tel" className={inputCls} placeholder="9876543210" /></div>

              <div className="border border-gray-200 dark:border-gray-600 rounded-lg">
                <button type="button" onClick={() => setShowMore(s => !s)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-300">
                  More details: GSTIN, address, old balance
                  <ChevronDown className={cn('w-4 h-4 transition-transform', showMore && 'rotate-180')} />
                </button>
                {showMore && (
                  <div className="px-4 pb-4 grid grid-cols-2 gap-3">
                    <div className="col-span-2"><label className={labelCls}>Email</label><input value={form.email} onChange={set('email')} type="email" className={inputCls} /></div>
                    <div><label className={labelCls}>GSTIN</label><input value={form.gstin} onChange={set('gstin')} className={cn(inputCls, 'uppercase')} maxLength={15} placeholder="Only if registered" /></div>
                    <div><label className={labelCls}>PAN</label><input value={form.pan} onChange={set('pan')} className={cn(inputCls, 'uppercase')} maxLength={10} /></div>
                    <div className="col-span-2"><label className={labelCls}>Address</label><input value={form.line1} onChange={set('line1')} className={inputCls} placeholder="Shop / street" /></div>
                    <input value={form.city} onChange={set('city')} className={inputCls} placeholder="City" aria-label="City" />
                    <input value={form.state} onChange={set('state')} className={inputCls} placeholder="State" aria-label="State" />
                    <input value={form.pincode} onChange={set('pincode')} className={inputCls} placeholder="Pincode" aria-label="Pincode" inputMode="numeric" />
                    <div className="col-span-2"><label className={labelCls}>{t.opening}</label><input value={form.openingBalance} onChange={set('openingBalance')} inputMode="decimal" className={inputCls} placeholder="₹0" /></div>
                    <div className="col-span-2"><label className={labelCls}>{t.days}</label><input value={form.days} onChange={set('days')} inputMode="numeric" className={inputCls} placeholder="30" /></div>
                  </div>
                )}
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex gap-3 justify-end pt-1">
                <Button variant="secondary" type="button" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button type="submit" loading={saveMut.isPending}>{editId ? 'Save' : t.add}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
