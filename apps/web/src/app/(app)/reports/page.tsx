'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PageHeader, Card, Button } from '@/components/shared';
import { Download, BarChart3, DollarSign, Package, Users } from 'lucide-react';
import { useState } from 'react';

export default function ReportsPage() {
  const [reportType, setReportType] = useState<'sales' | 'purchases' | 'outstanding' | 'expenses' | 'inventory'>('sales');

  const { data: salesReport } = useQuery({ queryKey: ['report-sales'], queryFn: () => api.reports.getSalesSummary(), select: r => r.data.data, enabled: reportType === 'sales' });
  const { data: purchaseReport } = useQuery({ queryKey: ['report-purchases'], queryFn: () => api.reports.getPurchasesSummary(), select: r => r.data.data, enabled: reportType === 'purchases' });
  const { data: outstandingReport } = useQuery({ queryKey: ['report-outstanding'], queryFn: () => api.reports.getOutstanding(), select: r => r.data.data, enabled: reportType === 'outstanding' });
  const { data: expenseReport } = useQuery({ queryKey: ['report-expenses'], queryFn: () => api.reports.getExpensesSummary(), select: r => r.data.data, enabled: reportType === 'expenses' });
  const { data: inventoryReport } = useQuery({ queryKey: ['report-inventory'], queryFn: () => api.reports.getInventoryAging(), select: r => r.data.data, enabled: reportType === 'inventory' });

  const reports = [
    { key: 'sales', label: 'Sales Report', icon: BarChart3, description: 'Revenue, top products, top customers' },
    { key: 'purchases', label: 'Purchase Report', icon: DollarSign, description: 'Procurement analysis' },
    { key: 'outstanding', label: 'Outstanding', icon: Users, description: 'Receivables & payables' },
    { key: 'expenses', label: 'Expenses', icon: DollarSign, description: 'Expense analysis by category' },
    { key: 'inventory', label: 'Inventory', icon: Package, description: 'Aging & fast-moving items' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" subtitle="Comprehensive business reports" actions={<Button variant="secondary" size="sm"><Download className="w-4 h-4" /> Export All</Button>} />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {reports.map(r => (
          <button key={r.key} onClick={() => setReportType(r.key as any)} className={`p-4 rounded-xl border-2 text-left transition ${reportType === r.key ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-orange-300'}`}>
            <r.icon className={`w-5 h-5 mb-2 ${reportType === r.key ? 'text-orange-600' : 'text-gray-400'}`} />
            <p className={`text-sm font-semibold ${reportType === r.key ? 'text-orange-700' : 'text-gray-700 dark:text-gray-300'}`}>{r.label}</p>
            <p className="text-xs text-gray-400 mt-0.5 hidden md:block">{r.description}</p>
          </button>
        ))}
      </div>

      {reportType === 'sales' && salesReport && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-5"><p className="text-sm text-gray-500">Total Revenue</p><p className="text-2xl font-bold text-green-600 mt-1">{formatCurrency(salesReport.aggregate?._sum?.totalAmount || 0)}</p></Card>
            <Card className="p-5"><p className="text-sm text-gray-500">Total Invoices</p><p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{salesReport.aggregate?._count?.id || 0}</p></Card>
            <Card className="p-5"><p className="text-sm text-gray-500">Avg. Invoice Value</p><p className="text-2xl font-bold text-orange-600 mt-1">{formatCurrency(salesReport.aggregate?._avg?.totalAmount || 0)}</p></Card>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-5">
              <h3 className="font-semibold mb-3">Top Products</h3>
              <div className="space-y-2">
                {(salesReport.topProducts || []).map((p: any, i: number) => (
                  <div key={i} className="flex justify-between text-sm"><span className="text-gray-700 dark:text-gray-300">{p.product?.name}</span><span className="font-semibold">{formatCurrency(p._sum?.totalPrice || 0)}</span></div>
                ))}
              </div>
            </Card>
            <Card className="p-5">
              <h3 className="font-semibold mb-3">Top Customers</h3>
              <div className="space-y-2">
                {(salesReport.topCustomers || []).map((c: any, i: number) => (
                  <div key={i} className="flex justify-between text-sm"><span className="text-gray-700 dark:text-gray-300">{c.customer?.name}</span><span className="font-semibold">{formatCurrency(c._sum?.totalAmount || 0)}</span></div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {reportType === 'outstanding' && outstandingReport && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="p-5">
            <h3 className="font-semibold text-red-600 mb-3">Receivables (Customers Owe You)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-200 dark:border-gray-700">{['Customer', 'Amount'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase pb-2">{h}</th>)}</tr></thead>
                <tbody>{(outstandingReport.receivables || []).map((r: any) => <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700"><td className="py-2">{r.name}</td><td className="py-2 font-semibold text-red-600">{formatCurrency(r.outstandingAmount)}</td></tr>)}</tbody>
              </table>
              {!outstandingReport.receivables?.length && <p className="text-center py-4 text-gray-500 text-sm">No outstanding receivables</p>}
            </div>
          </Card>
          <Card className="p-5">
            <h3 className="font-semibold text-orange-600 mb-3">Payables (You Owe Suppliers)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-200 dark:border-gray-700">{['Supplier', 'Amount'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase pb-2">{h}</th>)}</tr></thead>
                <tbody>{(outstandingReport.payables || []).map((p: any) => <tr key={p.id} className="border-b border-gray-100 dark:border-gray-700"><td className="py-2">{p.name}</td><td className="py-2 font-semibold text-orange-600">{formatCurrency(p.outstandingAmount)}</td></tr>)}</tbody>
              </table>
              {!outstandingReport.payables?.length && <p className="text-center py-4 text-gray-500 text-sm">No outstanding payables</p>}
            </div>
          </Card>
        </div>
      )}

      {reportType === 'expenses' && expenseReport && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-5"><p className="text-sm text-gray-500">Total Expenses</p><p className="text-2xl font-bold text-red-600 mt-1">{formatCurrency(expenseReport.aggregate?._sum?.amount || 0)}</p></Card>
            <Card className="p-5"><p className="text-sm text-gray-500">Number of Expenses</p><p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{expenseReport.aggregate?._count?.id || 0}</p></Card>
          </div>
          <Card className="p-5">
            <h3 className="font-semibold mb-3">By Category</h3>
            <div className="space-y-2">
              {(expenseReport.byCategory || []).map((c: any) => (
                <div key={c.categoryId || 'none'} className="flex justify-between text-sm py-1.5 border-b border-gray-100 dark:border-gray-700">
                  <span className="text-gray-700 dark:text-gray-300">{c.category?.name || 'Uncategorized'}</span>
                  <span className="font-semibold">{formatCurrency(c._sum?.amount || 0)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
