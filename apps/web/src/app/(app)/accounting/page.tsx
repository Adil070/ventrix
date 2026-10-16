'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PageHeader, Button, Card, EmptyState, StatusBadge } from '@/components/shared';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Dates are stored as UTC midnight of the chosen day, so ranges are sent as whole UTC days.
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const endOfDay = (day: string) => `${day}T23:59:59.999Z`;

type Period = 'this-month' | 'last-month' | 'this-fy' | 'all';
const PERIODS: [Period, string][] = [['this-month', 'This month'], ['last-month', 'Last month'], ['this-fy', 'This financial year'], ['all', 'All time']];

function periodRange(p: Period) {
  const now = new Date();
  if (p === 'this-month') return { fromDate: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), toDate: endOfDay(ymd(now)) };
  if (p === 'last-month') return { fromDate: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), toDate: endOfDay(ymd(new Date(now.getFullYear(), now.getMonth(), 0))) };
  if (p === 'this-fy') {
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // Indian FY starts 1 April
    return { fromDate: `${fyStartYear}-04-01`, toDate: endOfDay(ymd(now)) };
  }
  return { fromDate: '2000-01-01', toDate: endOfDay(ymd(now)) };
}

// Assets and expenses normally carry a debit balance; everything else a credit balance.
const DEBIT_NATURE = ['ASSET', 'EXPENSE'];

const ENTRY_TYPE_LABEL: Record<string, string> = {
  SALES: 'Sale', PURCHASE: 'Purchase', PAYMENT: 'Payment made', RECEIPT: 'Payment received', JOURNAL: 'Journal',
  CONTRA: 'Contra', DEBIT_NOTE: 'Debit note', CREDIT_NOTE: 'Credit note', OPENING_BALANCE: 'Opening balance', CLOSING_BALANCE: 'Closing balance',
};

const JOURNAL_PAGE_SIZE = 20;

export default function AccountingPage() {
  const [tab, setTab] = useState<'accounts' | 'journal' | 'trial-balance' | 'profit-loss' | 'balance-sheet'>('accounts');
  const [plPeriod, setPlPeriod] = useState<Period>('this-fy');
  const [journalPage, setJournalPage] = useState(1);
  const asOf = endOfDay(ymd(new Date()));

  // GET /accounting/accounts → data: Account[] (no running balance; balances come from the trial balance)
  const { data: accounts, isLoading: accountsLoading } = useQuery({ queryKey: ['accounts'], queryFn: () => api.accounting.getAccounts(), select: r => (r.data.data || []) as any[], enabled: tab === 'accounts' });
  // GET /accounting/journal → paginated: data: JournalEntry[], pagination.total
  const { data: journal, isLoading: journalLoading } = useQuery({
    queryKey: ['journal', journalPage],
    queryFn: () => api.accounting.getJournal({ page: journalPage, limit: JOURNAL_PAGE_SIZE }),
    select: r => ({ entries: (r.data.data || []) as any[], total: Number(r.data.pagination?.total || 0), totalPages: Number(r.data.pagination?.totalPages || 1) }),
    enabled: tab === 'journal',
  });
  // GET /accounting/reports/trial-balance → data: [{ accountId, code, name, type, debit, credit, balance }]
  const { data: trialBalance } = useQuery({ queryKey: ['trial-balance', asOf], queryFn: () => api.accounting.getTrialBalance({ asOfDate: asOf }), select: r => (r.data.data || []) as any[], enabled: tab === 'trial-balance' || tab === 'accounts' });
  // GET /accounting/reports/profit-loss → { revenue: {breakdown,total}, cogs, grossProfit, operatingExpenses: {breakdown,total}, netProfit, ... }
  // Without fromDate/toDate the API uses today..today, so a range is always sent.
  const plRange = periodRange(plPeriod);
  const { data: pl } = useQuery({ queryKey: ['profit-loss', plRange.fromDate, plRange.toDate], queryFn: () => api.accounting.getProfitLoss(plRange), select: r => r.data.data, enabled: tab === 'profit-loss' });
  // GET /accounting/reports/balance-sheet → { assets: {breakdown,total}, liabilities: {...}, equity: {...} }
  const { data: bs } = useQuery({ queryKey: ['balance-sheet', asOf], queryFn: () => api.accounting.getBalanceSheet({ asOfDate: asOf }), select: r => r.data.data, enabled: tab === 'balance-sheet' });
  // Profit not yet closed to equity, so the balance sheet balances (assets = liabilities + equity + profit to date).
  const allTime = periodRange('all');
  const { data: profitToDate } = useQuery({ queryKey: ['profit-loss', allTime.fromDate, allTime.toDate], queryFn: () => api.accounting.getProfitLoss(allTime), select: r => Number(r.data.data?.netProfit || 0), enabled: tab === 'balance-sheet' });

  const balanceByAccount = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of trialBalance || []) {
      const net = Number(row.balance || 0); // debit − credit
      map[row.accountId] = DEBIT_NATURE.includes(row.type) ? net : -net;
    }
    return map;
  }, [trialBalance]);

  // Classic trial balance: each account's net balance in its Debit or Credit column.
  const tbRows = (trialBalance || []).filter(a => Math.abs(Number(a.balance || 0)) >= 0.005);
  const tbTotalDebit = tbRows.reduce((s, a) => s + Math.max(Number(a.balance), 0), 0);
  const tbTotalCredit = tbRows.reduce((s, a) => s + Math.max(-Number(a.balance), 0), 0);

  const revenueTotal = Number(pl?.revenue?.total || 0);
  const expensesTotal = Number(pl?.operatingExpenses?.total || 0); // all EXPENSE accounts, cost of goods included
  const netProfit = Number(pl?.netProfit || 0);

  const nonZero = (rows: any[] | undefined) => (rows || []).filter(r => Math.abs(Number(r.balance || 0)) >= 0.005);
  const assetsTotal = Number(bs?.assets?.total || 0);
  const liabilitiesTotal = Number(bs?.liabilities?.total || 0);
  const equityTotal = Number(bs?.equity?.total || 0);
  const lePlusProfit = liabilitiesTotal + equityTotal + (profitToDate || 0);

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
                {(accounts || []).map((a: any) => (
                  <tr key={a.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{a.name}{a.parent && <span className="block text-xs text-gray-400">under {a.parent.name}</span>}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{a.code}</td>
                    <td className="px-4 py-3"><StatusBadge status={a.type} /></td>
                    <td className="px-4 py-3 font-semibold">{formatCurrency(balanceByAccount[a.id] ?? Number(a.openingBalance || 0))}</td>
                  </tr>
                ))}
                {!accountsLoading && !accounts?.length && <tr><td colSpan={4}><EmptyState title="No accounts" description="Chart of accounts will appear here" /></td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'journal' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700">
                {['Date', 'Entry #', 'Description', 'Type', 'Amount'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}
              </tr></thead>
              <tbody>
                {(journal?.entries || []).map((e: any) => (
                  <tr key={e.id} className="border-b border-gray-100 dark:border-gray-700 align-top">
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{formatDate(e.date)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white whitespace-nowrap">{e.entryNumber}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                      {e.description || '-'}
                      <div className="mt-1 space-y-0.5">
                        {(e.lines || []).map((l: any) => {
                          const dr = Number(l.debitAmount || 0);
                          return <p key={l.id} className="text-xs text-gray-400">{dr > 0 ? 'Dr' : 'Cr'} {l.account?.name || 'Account'} · {formatCurrency(dr > 0 ? dr : Number(l.creditAmount || 0))}</p>;
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={e.type} label={ENTRY_TYPE_LABEL[e.type]} /></td>
                    <td className="px-4 py-3 font-semibold whitespace-nowrap">{formatCurrency(Number(e.totalDebit || 0))}</td>
                  </tr>
                ))}
                {!journalLoading && !journal?.entries?.length && <tr><td colSpan={5}><EmptyState title="No journal entries" description="Sales, purchases and payments are posted here automatically" /></td></tr>}
              </tbody>
            </table>
          </div>
          {(journal?.total || 0) > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-700 text-sm text-gray-500">
              <span>{journal!.total} {journal!.total === 1 ? 'entry' : 'entries'}</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={journalPage <= 1} onClick={() => setJournalPage(p => p - 1)}>Previous</Button>
                <span>Page {journalPage} of {journal!.totalPages || 1}</span>
                <Button size="sm" variant="secondary" disabled={journalPage >= (journal!.totalPages || 1)} onClick={() => setJournalPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {tab === 'trial-balance' && (
        <Card className="p-6">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Trial Balance <span className="text-sm font-normal text-gray-500">as of {formatDate(new Date())}</span></h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b-2 border-gray-300 dark:border-gray-600">
                {['Account', 'Debit', 'Credit'].map(h => <th key={h} className="text-left text-sm font-semibold px-4 py-2">{h}</th>)}
              </tr></thead>
              <tbody>
                {tbRows.map((a: any) => {
                  const net = Number(a.balance);
                  return (
                    <tr key={a.accountId} className="border-b border-gray-100 dark:border-gray-700">
                      <td className="px-4 py-2 text-sm">{a.name} <span className="text-xs text-gray-400">{a.code}</span></td>
                      <td className="px-4 py-2 text-sm font-medium">{net > 0 ? formatCurrency(net) : '-'}</td>
                      <td className="px-4 py-2 text-sm font-medium">{net < 0 ? formatCurrency(-net) : '-'}</td>
                    </tr>
                  );
                })}
                {trialBalance && !tbRows.length && <tr><td colSpan={3} className="text-center py-8 text-gray-500 text-sm">No balances yet</td></tr>}
                <tr className="border-t-2 border-gray-300 dark:border-gray-600 font-bold">
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2">{formatCurrency(tbTotalDebit)}</td>
                  <td className="px-4 py-2">{formatCurrency(tbTotalCredit)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'profit-loss' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Period:</label>
            <select value={plPeriod} onChange={e => setPlPeriod(e.target.value as Period)} className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-orange-500 outline-none">
              {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="p-5"><div className="text-center"><p className="text-gray-500 text-sm">Total Revenue</p><p className="text-3xl font-bold text-green-600 mt-1">{formatCurrency(revenueTotal)}</p></div></Card>
            <Card className="p-5"><div className="text-center"><p className="text-gray-500 text-sm">Total Expenses</p><p className="text-3xl font-bold text-red-600 mt-1">{formatCurrency(expensesTotal)}</p></div></Card>
            <Card className="p-5"><div className="text-center"><p className="text-gray-500 text-sm">{netProfit >= 0 ? 'Net Profit' : 'Net Loss'}</p><p className={`text-3xl font-bold mt-1 ${netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(netProfit)}</p></div></Card>
            <Card className="md:col-span-3 p-5">
              <h3 className="font-semibold mb-4">Revenue vs Expenses</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={[{ name: PERIODS.find(([k]) => k === plPeriod)?.[1] || 'Period', revenue: revenueTotal, expenses: expensesTotal }]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: any) => formatCurrency(v)} />
                  <Bar dataKey="revenue" fill="#10b981" name="Revenue" />
                  <Bar dataKey="expenses" fill="#ef4444" name="Expenses" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card className="p-5">
              <h3 className="font-semibold mb-3">Income</h3>
              {nonZero(pl?.revenue?.breakdown).map((a: any) => <div key={a.accountId} className="flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 text-sm"><span>{a.name}</span><span className="font-semibold">{formatCurrency(Number(a.balance))}</span></div>)}
              {!nonZero(pl?.revenue?.breakdown).length && <p className="text-sm text-gray-500">No income in this period</p>}
            </Card>
            <Card className="p-5 md:col-span-2">
              <h3 className="font-semibold mb-3">Expenses</h3>
              {nonZero(pl?.operatingExpenses?.breakdown).map((a: any) => <div key={a.accountId} className="flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 text-sm"><span>{a.name}</span><span className="font-semibold">{formatCurrency(Number(a.balance))}</span></div>)}
              {!nonZero(pl?.operatingExpenses?.breakdown).length && <p className="text-sm text-gray-500">No expenses posted in this period</p>}
            </Card>
          </div>
        </div>
      )}

      {tab === 'balance-sheet' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3 text-lg">Assets</h3>
            {nonZero(bs?.assets?.breakdown).map((a: any) => <div key={a.accountId} className="flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 text-sm"><span>{a.name}</span><span className="font-semibold">{formatCurrency(Number(a.balance))}</span></div>)}
            <div className="flex justify-between font-bold text-base mt-3 pt-2 border-t-2 border-gray-300"><span>Total Assets</span><span>{formatCurrency(assetsTotal)}</span></div>
          </Card>
          <Card className="p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3 text-lg">Liabilities & Equity</h3>
            {nonZero(bs?.liabilities?.breakdown).map((a: any) => <div key={a.accountId} className="flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 text-sm"><span>{a.name}</span><span className="font-semibold">{formatCurrency(Number(a.balance))}</span></div>)}
            <div className="flex justify-between py-1.5 text-sm text-gray-500"><span>Total Liabilities</span><span>{formatCurrency(liabilitiesTotal)}</span></div>
            {nonZero(bs?.equity?.breakdown).map((a: any) => <div key={a.accountId} className="flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 text-sm"><span>{a.name}</span><span className="font-semibold">{formatCurrency(Number(a.balance))}</span></div>)}
            <div className="flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 text-sm"><span>Profit to date (not yet moved to equity)</span><span className="font-semibold">{formatCurrency(profitToDate || 0)}</span></div>
            <div className="flex justify-between font-bold text-base mt-3 pt-2 border-t-2 border-gray-300"><span>Total Liabilities & Equity</span><span>{formatCurrency(lePlusProfit)}</span></div>
            {bs && Math.abs(assetsTotal - lePlusProfit) >= 0.01 && <p className="text-xs text-red-500 mt-2">Out of balance by {formatCurrency(assetsTotal - lePlusProfit)}</p>}
          </Card>
        </div>
      )}
    </div>
  );
}
