'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { PageHeader, Button, Card, EmptyState, StatusBadge } from '@/components/shared';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

export default function AccountingPage() {
  const [tab, setTab] = useState<'accounts' | 'journal' | 'trial-balance' | 'profit-loss' | 'balance-sheet'>('accounts');

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => api.accounting.getAccounts(), select: r => r.data.data, enabled: tab === 'accounts' });
  const { data: journal } = useQuery({ queryKey: ['journal'], queryFn: () => api.accounting.getJournal(), select: r => r.data.data, enabled: tab === 'journal' });
  const { data: trialBalance } = useQuery({ queryKey: ['trial-balance'], queryFn: () => api.accounting.getTrialBalance(), select: r => r.data.data, enabled: tab === 'trial-balance' });
  const { data: pl } = useQuery({ queryKey: ['profit-loss'], queryFn: () => api.accounting.getProfitLoss(), select: r => r.data.data, enabled: tab === 'profit-loss' });
  const { data: bs } = useQuery({ queryKey: ['balance-sheet'], queryFn: () => api.accounting.getBalanceSheet(), select: r => r.data.data, enabled: tab === 'balance-sheet' });

  const tabs = [['accounts', 'Chart of Accounts'], ['journal', 'Journal Entries'], ['trial-balance', 'Trial Balance'], ['profit-loss', 'P&L Statement'], ['balance-sheet', 'Balance Sheet']];

  return (
    <div className="space-y-6">
      <PageHeader title="Accounting" subtitle="Double-entry bookkeeping and financial reports" />

      <div className="flex gap-2 overflow-x-auto border-b border-gray-200 dark:border-gray-700 pb-0">
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key as any)} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition ${tab === key ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{label}</button>
        ))}
      </div>

      {tab === 'accounts' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700">
                {['Account Name', 'Code', 'Type', 'Balance'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}
              </tr></thead>
              <tbody>
                {(accounts?.accounts || []).map((a: any) => (
                  <tr key={a.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{a.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{a.code}</td>
                    <td className="px-4 py-3"><StatusBadge status={a.type} /></td>
                    <td className="px-4 py-3 font-semibold">{formatCurrency(a.balance || 0)}</td>
                  </tr>
                ))}
                {!(accounts?.accounts?.length) && <tr><td colSpan={4}><EmptyState title="No accounts" description="Chart of accounts will appear here" /></td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'trial-balance' && (
        <Card className="p-6">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Trial Balance</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b-2 border-gray-300 dark:border-gray-600">
                {['Account', 'Debit', 'Credit'].map(h => <th key={h} className="text-left text-sm font-semibold px-4 py-2">{h}</th>)}
              </tr></thead>
              <tbody>
                {(trialBalance?.accounts || []).map((a: any) => (
                  <tr key={a.id} className="border-b border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2 text-sm">{a.name}</td>
                    <td className="px-4 py-2 text-sm font-medium">{a.debitBalance > 0 ? formatCurrency(a.debitBalance) : '-'}</td>
                    <td className="px-4 py-2 text-sm font-medium">{a.creditBalance > 0 ? formatCurrency(a.creditBalance) : '-'}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-300 dark:border-gray-600 font-bold">
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2">{formatCurrency(trialBalance?.totalDebit || 0)}</td>
                  <td className="px-4 py-2">{formatCurrency(trialBalance?.totalCredit || 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'profit-loss' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="p-5"><div className="text-center"><p className="text-gray-500 text-sm">Total Revenue</p><p className="text-3xl font-bold text-green-600 mt-1">{formatCurrency(pl?.totalRevenue || 0)}</p></div></Card>
          <Card className="p-5"><div className="text-center"><p className="text-gray-500 text-sm">Total Expenses</p><p className="text-3xl font-bold text-red-600 mt-1">{formatCurrency(pl?.totalExpenses || 0)}</p></div></Card>
          <Card className="p-5"><div className="text-center"><p className="text-gray-500 text-sm">Net Profit</p><p className={`text-3xl font-bold mt-1 ${(pl?.netProfit || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(pl?.netProfit || 0)}</p></div></Card>
          <Card className="md:col-span-3 p-5">
            <h3 className="font-semibold mb-4">Revenue vs Expenses</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={[{ name: 'Current Period', revenue: pl?.totalRevenue || 0, expenses: pl?.totalExpenses || 0 }]}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: any) => formatCurrency(v)} />
                <Bar dataKey="revenue" fill="#10b981" name="Revenue" />
                <Bar dataKey="expenses" fill="#ef4444" name="Expenses" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      {tab === 'balance-sheet' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3 text-lg">Assets</h3>
            {(bs?.assets || []).map((a: any) => <div key={a.id} className="flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 text-sm"><span>{a.name}</span><span className="font-semibold">{formatCurrency(a.balance)}</span></div>)}
            <div className="flex justify-between font-bold text-base mt-3 pt-2 border-t-2 border-gray-300"><span>Total Assets</span><span>{formatCurrency(bs?.totalAssets || 0)}</span></div>
          </Card>
          <Card className="p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3 text-lg">Liabilities & Equity</h3>
            {(bs?.liabilities || []).map((a: any) => <div key={a.id} className="flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 text-sm"><span>{a.name}</span><span className="font-semibold">{formatCurrency(a.balance)}</span></div>)}
            <div className="flex justify-between font-bold text-base mt-3 pt-2 border-t-2 border-gray-300"><span>Total L+E</span><span>{formatCurrency(bs?.totalLiabilities || 0)}</span></div>
          </Card>
        </div>
      )}
    </div>
  );
}
