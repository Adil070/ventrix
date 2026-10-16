'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { PAYMENT_MODES, type PaymentMode, paymentModeLabel, today } from '@/lib/business';
import { useOpenFromUrl } from '@/hooks/useOpenFromUrl';
import { useUnpaidBills, allocateOldestFirst } from '@/hooks/useUnpaidBills';
import { PageHeader, Button, Card, EmptyState } from '@/components/shared';
import { PartyPicker } from '@/components/shared/Pickers';
import type { SelectOption } from '@/components/shared/SearchSelect';
import { Plus, Search, X, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';

type PayType = 'RECEIPT' | 'PAYMENT';

export default function PaymentsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [type, setType] = useState(useSearchParams().get('type') || '');
  const [page, setPage] = useState(1);

  const [showForm, setShowForm] = useState(false);
  const [payType, setPayType] = useState<PayType>('RECEIPT');
  const [party, setParty] = useState<SelectOption | null>(null);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PaymentMode>('CASH');
  const [date, setDate] = useState(today());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['payments', search, type, page],
    queryFn: () => api.payments.list({ search: search || undefined, type: type || undefined, page, limit: 20 }),
    select: r => r.data.data,
  });

  const openForm = (t: PayType) => {
    setPayType(t); setParty(null); setAmount(''); setMode('CASH'); setDate(today()); setReference(''); setNotes(''); setError('');
    setShowForm(true);
  };
  useOpenFromUrl(v => openForm(v === 'out' ? 'PAYMENT' : 'RECEIPT'));

  const partyKind = payType === 'RECEIPT' ? 'customer' : 'supplier';
  const { data: unpaid = [], isFetching: loadingBills } = useUnpaidBills(partyKind, party?.id);
  const owed = unpaid.reduce((s, b) => s + b.balance, 0);
  const { allocations, advance } = allocateOldestFirst(unpaid, Number(amount) || 0);

  const createMut = useMutation({
    // Without allocations the API records the money but leaves every bill unpaid,
    // so settle the party's oldest bills first, the way most shops keep their books.
    mutationFn: () => api.payments.record({
      type: payType,
      ...(payType === 'RECEIPT' ? { customerId: party?.id } : { supplierId: party?.id }),
      allocations: allocations.length
        ? allocations.map(a => (payType === 'RECEIPT' ? { invoiceId: a.id, amount: a.amount } : { purchaseId: a.id, amount: a.amount }))
        : undefined,
      amount: Number(amount),
      paymentMode: mode,
      paymentDate: date,
      referenceNumber: reference || undefined,
      notes: notes || undefined,
    }),
    onSuccess: () => {
      ['payments', 'dashboard', 'unpaid-bills', 'invoices', 'purchases', 'invoice', 'dues', 'report-outstanding'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      toast.success('Payment saved');
      setShowForm(false);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not save payment'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!party) return setError(payType === 'RECEIPT' ? 'Choose the customer who paid.' : 'Choose the supplier you paid.');
    if (!(Number(amount) > 0)) return setError('Enter the amount.');
    setError('');
    createMut.mutate();
  };

  const inputCls = 'w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        subtitle="Money you received from customers and paid to suppliers"
        actions={<div className="flex gap-2">
          <Button size="sm" onClick={() => openForm('RECEIPT')}><ArrowDownCircle className="w-4 h-4" /> Receive money</Button>
          <Button size="sm" variant="secondary" onClick={() => openForm('PAYMENT')}><ArrowUpCircle className="w-4 h-4" /> Pay supplier</Button>
        </div>}
      />

      <Card className="p-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none bg-white dark:bg-gray-700" placeholder="Search payments…" />
          </div>
          <select value={type} onChange={e => { setType(e.target.value); setPage(1); }} className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-orange-500 outline-none">
            <option value="">Money in &amp; out</option>
            <option value="RECEIPT">Money in</option>
            <option value="PAYMENT">Money out</option>
          </select>
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-gray-200 dark:border-gray-700">
              {['Date', 'In / Out', 'Customer / Supplier', 'Paid by', 'Amount', 'Reference'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}
            </tr></thead>
            <tbody>
              {isLoading && Array(6).fill(0).map((_, i) => <tr key={i}><td colSpan={6}><div className="h-10 bg-gray-100 dark:bg-gray-700 animate-pulse m-3 rounded" /></td></tr>)}
              {!isLoading && data?.payments?.map((p: any) => (
                <tr key={p.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                  <td className="px-4 py-3 text-sm text-gray-500">{formatDate(p.paymentDate)}</td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full', p.type === 'RECEIPT' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-700')}>
                      {p.type === 'RECEIPT' ? <ArrowDownCircle className="w-3 h-3" /> : <ArrowUpCircle className="w-3 h-3" />}
                      {p.type === 'RECEIPT' ? 'In' : 'Out'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{p.customer?.name || p.supplier?.name || 'Walk-in customer'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{paymentModeLabel(p.mode ?? p.paymentMode)}</td>
                  <td className="px-4 py-3 font-semibold text-sm">{formatCurrency(p.amount)}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{p.referenceNumber || '-'}</td>
                </tr>
              ))}
              {!isLoading && !data?.payments?.length && (
                <tr><td colSpan={6}>
                  <EmptyState
                    title="No payments yet"
                    description="Payments taken while making a sale appear here automatically. Use “Receive money” when a customer pays for an older bill."
                    action={<Button size="sm" onClick={() => openForm('RECEIPT')}><Plus className="w-4 h-4" /> Receive money</Button>}
                  />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {data?.total > 20 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500">{(page - 1) * 20 + 1}–{Math.min(page * 20, data.total)} of {data.total}</p>
            <div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button><Button variant="secondary" size="sm" disabled={page * 20 >= data.total} onClick={() => setPage(p => p + 1)}>Next</Button></div>
          </div>
        )}
      </Card>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">{payType === 'RECEIPT' ? 'Receive money' : 'Pay a supplier'}</h2>
              <button onClick={() => setShowForm(false)} aria-label="Close"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={submit} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {(['RECEIPT', 'PAYMENT'] as const).map(t => (
                  <button key={t} type="button" onClick={() => { setPayType(t); setParty(null); }} className={cn('flex items-center justify-center gap-2 p-2.5 border-2 rounded-lg text-sm font-medium transition', payType === t ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20 text-orange-700' : 'border-gray-200 dark:border-gray-600 text-gray-600')}>
                    {t === 'RECEIPT' ? <ArrowDownCircle className="w-4 h-4" /> : <ArrowUpCircle className="w-4 h-4" />}
                    {t === 'RECEIPT' ? 'Money in' : 'Money out'}
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{payType === 'RECEIPT' ? 'Who paid you?' : 'Which supplier did you pay?'}</label>
                <PartyPicker key={payType} kind={payType === 'RECEIPT' ? 'customer' : 'supplier'} value={party?.id ?? null} selectedLabel={party?.label} onChange={opt => { setParty(opt); setAmount(''); }} />
                {party && !loadingBills && (
                  <p className="text-xs text-gray-500 mt-1">
                    {owed > 0
                      ? <>{payType === 'RECEIPT' ? `${party.label} owes you` : `You owe ${party.label}`} <strong>{formatCurrency(owed)}</strong> on {unpaid.length} {unpaid.length === 1 ? 'bill' : 'bills'}. <button type="button" onClick={() => setAmount(String(owed))} className="text-orange-600 hover:underline">Use full amount</button></>
                      : 'No unpaid bills. This will be saved as an advance.'}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount</label><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className={cn(inputCls, 'font-semibold')} placeholder="₹" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Paid by</label>
                <div className="flex flex-wrap gap-2">
                  {PAYMENT_MODES.map(m => (
                    <button key={m.value} type="button" onClick={() => setMode(m.value)} className={cn('px-3 py-1.5 rounded-full text-sm border transition', mode === m.value ? 'bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300')}>{m.label}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reference <span className="text-gray-400 font-normal">(optional)</span></label><input value={reference} onChange={e => setReference(e.target.value)} className={inputCls} placeholder="UTR / cheque no." /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Note <span className="text-gray-400 font-normal">(optional)</span></label><input value={notes} onChange={e => setNotes(e.target.value)} className={inputCls} /></div>
              </div>
              {allocations.length > 0 && (
                <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 p-3 text-xs text-gray-600 dark:text-gray-300 space-y-1">
                  <p className="font-medium">This will settle, oldest first:</p>
                  {allocations.map(a => {
                    const bill = unpaid.find(b => b.id === a.id)!;
                    return <p key={a.id} className="flex justify-between"><span>{bill.number} · {formatDate(bill.date)}</span><span>{formatCurrency(a.amount)}{a.amount < bill.balance ? ' (part)' : ''}</span></p>;
                  })}
                  {advance > 0 && <p className="flex justify-between text-gray-500"><span>Extra, kept as advance</span><span>{formatCurrency(advance)}</span></p>}
                </div>
              )}
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex gap-3 justify-end pt-1">
                <Button variant="secondary" type="button" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button type="submit" loading={createMut.isPending}>Save payment</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
