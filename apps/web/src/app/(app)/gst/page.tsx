'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PageHeader, Card, Button } from '@/components/shared';
import { Download, FileText, AlertCircle } from 'lucide-react';

export default function GSTPage() {
  const [tab, setTab] = useState<'summary' | 'gstr1' | 'gstr3b' | 'hsn'>('summary');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());

  const { data: summary } = useQuery({ queryKey: ['gst-summary', month, year], queryFn: () => api.gst.getSummary({ month, year }), select: r => r.data.data });
  const { data: gstr1 } = useQuery({ queryKey: ['gstr1', month, year], queryFn: () => api.gst.getGSTR1({ month, year }), select: r => r.data.data, enabled: tab === 'gstr1' });
  const { data: gstr3b } = useQuery({ queryKey: ['gstr3b', month, year], queryFn: () => api.gst.getGSTR3B({ month, year }), select: r => r.data.data, enabled: tab === 'gstr3b' });
  const { data: hsn } = useQuery({ queryKey: ['hsn-codes'], queryFn: () => api.gst.listHSN(), select: r => r.data.data, enabled: tab === 'hsn' });

  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  return (
    <div className="space-y-6">
      <PageHeader title="GST Management" subtitle="GSTR-1, GSTR-3B filings and HSN/SAC codes" />

      {/* Period selector */}
      <Card className="p-4">
        <div className="flex gap-4 items-center flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Month:</label>
            <select value={month} onChange={e => setMonth(Number(e.target.value))} className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-orange-500 outline-none">
              {months.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Year:</label>
            <select value={year} onChange={e => setYear(Number(e.target.value))} className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-orange-500 outline-none">
              {[2022, 2023, 2024, 2025].map(y => <option key={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </Card>

      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        {[['summary', 'GST Summary'], ['gstr1', 'GSTR-1'], ['gstr3b', 'GSTR-3B'], ['hsn', 'HSN/SAC Codes']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key as any)} className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === key ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{label}</button>
        ))}
      </div>

      {tab === 'summary' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-5"><p className="text-sm text-gray-500">Output GST (Sales)</p><p className="text-2xl font-bold text-green-600 mt-1">{formatCurrency(summary?.outputGST || 0)}</p></Card>
            <Card className="p-5"><p className="text-sm text-gray-500">Input GST (Purchases)</p><p className="text-2xl font-bold text-blue-600 mt-1">{formatCurrency(summary?.inputGST || 0)}</p></Card>
            <Card className="p-5">
              <p className="text-sm text-gray-500">Net GST Payable</p>
              <p className={`text-2xl font-bold mt-1 ${(summary?.netGSTPayable || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(summary?.netGSTPayable || 0)}</p>
              {summary?.netGSTPayable > 0 && <div className="flex items-center gap-1 mt-2 text-xs text-red-500"><AlertCircle className="w-3 h-3" /> Payment due</div>}
            </Card>
          </div>

          <Card className="p-5">
            <h3 className="font-semibold mb-4">GST Breakup by Rate</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-gray-200 dark:border-gray-700">{['Tax Rate', 'Taxable Amount', 'CGST', 'SGST', 'IGST', 'Total Tax'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-2">{h}</th>)}</tr></thead>
                <tbody>
                  {(summary?.breakdown || []).map((r: any) => (
                    <tr key={r.taxRate} className="border-b border-gray-100 dark:border-gray-700">
                      <td className="px-4 py-2 font-medium">{r.taxRate}%</td>
                      <td className="px-4 py-2">{formatCurrency(r.taxableAmount)}</td>
                      <td className="px-4 py-2">{formatCurrency(r.cgst)}</td>
                      <td className="px-4 py-2">{formatCurrency(r.sgst)}</td>
                      <td className="px-4 py-2">{formatCurrency(r.igst)}</td>
                      <td className="px-4 py-2 font-semibold">{formatCurrency(r.totalTax)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === 'gstr1' && (
        <Card className="p-5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">GSTR-1 (Outward Supplies) — {months[month-1]} {year}</h3>
            <Button variant="secondary" size="sm"><Download className="w-4 h-4" /> Download JSON</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700">{['Invoice #', 'Customer', 'GSTIN', 'Date', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-3 py-2">{h}</th>)}</tr></thead>
              <tbody>
                {(gstr1?.invoices || []).map((inv: any) => (
                  <tr key={inv.id} className="border-b border-gray-100 dark:border-gray-700 text-sm">
                    <td className="px-3 py-2">{inv.invoiceNumber}</td>
                    <td className="px-3 py-2">{inv.customer?.name}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{inv.customer?.gstin || 'B2C'}</td>
                    <td className="px-3 py-2">{formatDate(inv.invoiceDate)}</td>
                    <td className="px-3 py-2">{formatCurrency(inv.taxableAmount)}</td>
                    <td className="px-3 py-2">{formatCurrency(inv.cgst)}</td>
                    <td className="px-3 py-2">{formatCurrency(inv.sgst)}</td>
                    <td className="px-3 py-2">{formatCurrency(inv.igst)}</td>
                    <td className="px-3 py-2 font-semibold">{formatCurrency(inv.totalAmount)}</td>
                  </tr>
                ))}
                {!gstr1?.invoices?.length && <tr><td colSpan={9} className="text-center py-8 text-gray-500">No invoices for this period</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'gstr3b' && (
        <Card className="p-5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">GSTR-3B Summary — {months[month-1]} {year}</h3>
            <Button variant="secondary" size="sm"><Download className="w-4 h-4" /> Download</Button>
          </div>
          <div className="space-y-3 max-w-md">
            <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700"><span className="text-gray-600 dark:text-gray-400">3.1 Outward taxable supplies</span><span className="font-semibold">{formatCurrency(gstr3b?.outwardTaxable || 0)}</span></div>
            <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700"><span className="text-gray-600 dark:text-gray-400">3.1 Tax on outward supplies</span><span className="font-semibold">{formatCurrency(gstr3b?.taxOnOutward || 0)}</span></div>
            <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700"><span className="text-gray-600 dark:text-gray-400">4 ITC Available</span><span className="font-semibold">{formatCurrency(gstr3b?.itcAvailable || 0)}</span></div>
            <div className="flex justify-between py-2 border-t-2 border-gray-300 font-bold"><span>Net Tax Payable</span><span className="text-red-600">{formatCurrency(gstr3b?.netTaxPayable || 0)}</span></div>
          </div>
        </Card>
      )}

      {tab === 'hsn' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700">{['HSN/SAC Code', 'Description', 'GST Rate', 'Category'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}</tr></thead>
              <tbody>
                {(hsn?.codes || []).map((h: any) => (
                  <tr key={h.id} className="border-b border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-3 font-medium text-orange-600">{h.code}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{h.description}</td>
                    <td className="px-4 py-3 text-sm">{h.defaultTaxRate}%</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{h.type}</td>
                  </tr>
                ))}
                {!hsn?.codes?.length && <tr><td colSpan={4} className="text-center py-8 text-gray-500">No HSN codes configured</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
