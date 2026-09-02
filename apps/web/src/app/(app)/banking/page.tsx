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
import { Plus, X, CreditCard, TrendingUp, TrendingDown } from 'lucide-react';

const BankAccountSchema = z.object({
  accountName: z.string().min(1, 'Required'),
  bankName: z.string().min(1, 'Required'),
  accountNumber: z.string().min(1, 'Required'),
  ifsc: z.string().optional(),
  accountType: z.enum(['SAVINGS', 'CURRENT', 'CASH', 'CREDIT_CARD']).default('CURRENT'),
  openingBalance: z.coerce.number().default(0),
  upiId: z.string().optional(),
});

type BankAccountForm = z.infer<typeof BankAccountSchema>;

export default function BankingPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['bank-accounts'], queryFn: () => api.banking.listAccounts(), select: r => r.data.data });
  const { data: transactions } = useQuery({ queryKey: ['bank-transactions', selectedAccount], queryFn: () => api.banking.getTransactions(selectedAccount!), select: r => r.data.data, enabled: !!selectedAccount });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<BankAccountForm>({ resolver: zodResolver(BankAccountSchema), defaultValues: { accountType: 'CURRENT', openingBalance: 0 } });

  const createMut = useMutation({
    mutationFn: (d: BankAccountForm) => api.banking.createAccount(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bank-accounts'] }); toast.success('Account added'); setShowForm(false); reset(); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const inputCls = "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none";

  return (
    <div className="space-y-6">
      <PageHeader title="Banking" subtitle="Bank accounts and transactions" actions={<Button size="sm" onClick={() => { reset({ accountType: 'CURRENT', openingBalance: 0 }); setShowForm(true); }}><Plus className="w-4 h-4" /> Add Account</Button>} />

      {/* Account Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {isLoading && Array(3).fill(0).map((_, i) => <div key={i} className="h-32 bg-gray-100 dark:bg-gray-700 animate-pulse rounded-xl" />)}
        {(data?.accounts || []).map((acc: any) => (
          <div key={acc.id} onClick={() => setSelectedAccount(acc.id === selectedAccount ? null : acc.id)} className={`cursor-pointer rounded-xl p-5 border-2 transition ${acc.id === selectedAccount ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-orange-300'}`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">{acc.accountName}</p>
                <p className="text-sm text-gray-500">{acc.bankName}</p>
                <p className="text-xs text-gray-400 mt-1">••••{acc.accountNumber?.slice(-4)}</p>
              </div>
              <CreditCard className="w-8 h-8 text-orange-500" />
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-3">{formatCurrency(acc.currentBalance || 0)}</p>
            <StatusBadge status={acc.accountType} className="mt-2" />
          </div>
        ))}
        {!isLoading && !data?.accounts?.length && <div className="md:col-span-3"><EmptyState title="No bank accounts" description="Add your first bank account" action={<Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Add Account</Button>} /></div>}
      </div>

      {/* Transactions */}
      {selectedAccount && (
        <Card className="p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Recent Transactions</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700">{['Date', 'Description', 'Type', 'Amount', 'Balance'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-3 py-2">{h}</th>)}</tr></thead>
              <tbody>
                {(transactions?.transactions || []).map((t: any) => (
                  <tr key={t.id} className="border-b border-gray-100 dark:border-gray-700">
                    <td className="px-3 py-2 text-sm text-gray-500">{formatDate(t.date)}</td>
                    <td className="px-3 py-2 text-sm text-gray-900 dark:text-white">{t.description}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${t.type === 'CREDIT' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                        {t.type === 'CREDIT' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{t.type}
                      </span>
                    </td>
                    <td className={`px-3 py-2 font-semibold text-sm ${t.type === 'CREDIT' ? 'text-green-600' : 'text-red-600'}`}>{t.type === 'CREDIT' ? '+' : '-'}{formatCurrency(t.amount)}</td>
                    <td className="px-3 py-2 font-semibold text-sm">{formatCurrency(t.balance)}</td>
                  </tr>
                ))}
                {!transactions?.transactions?.length && <tr><td colSpan={5} className="text-center py-8 text-gray-500 text-sm">No transactions yet</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Add Bank Account</h2>
              <button onClick={() => { setShowForm(false); reset(); }}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleSubmit(d => createMut.mutate(d))} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Account Name *</label><input {...register('accountName')} className={inputCls} placeholder="Main Current Account" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bank Name *</label><input {...register('bankName')} className={inputCls} placeholder="SBI, HDFC, ICICI..." /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Account Type</label><select {...register('accountType')} className={inputCls}>{['CURRENT', 'SAVINGS', 'CASH', 'CREDIT_CARD'].map(t => <option key={t}>{t}</option>)}</select></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Account Number *</label><input {...register('accountNumber')} className={inputCls} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">IFSC Code</label><input {...register('ifsc')} className={`${inputCls} uppercase`} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">UPI ID</label><input {...register('upiId')} className={inputCls} placeholder="name@upi" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Opening Balance (₹)</label><input {...register('openingBalance')} type="number" step="0.01" className={inputCls} /></div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <Button variant="secondary" type="button" onClick={() => { setShowForm(false); reset(); }}>Cancel</Button>
                <Button type="submit" loading={createMut.isPending}>Add Account</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
