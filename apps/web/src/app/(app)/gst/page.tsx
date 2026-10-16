'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PageHeader, Card, Button } from '@/components/shared';
import { Download, FileText, AlertCircle } from 'lucide-react';

const pad = (n: number) => String(n).padStart(2, '0');
const num = (v: any) => Number(v || 0); // Decimal sums arrive as strings or null

function downloadJSON(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function GSTPage() {
  const [tab, setTab] = useState<'summary' | 'gstr1' | 'gstr3b' | 'hsn'>('summary');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3];

  // gst-summary takes a date range (fromDate/toDate), not month/year; bill dates are stored as UTC midnight.
  const lastDay = new Date(year, month, 0).getDate();
  const range = { fromDate: `${year}-${pad(month)}-01`, toDate: `${year}-${pad(month)}-${pad(lastDay)}T23:59:59.999Z` };

  // → { outputTax: {cgst,sgst,igst,total}, inputTax: {...}, netGSTPayable, taxableAmount, totalSales, totalPurchases }
  const { data: summary } = useQuery({ queryKey: ['gst-summary', month, year], queryFn: () => api.gst.getSummary(range), select: r => r.data.data });
  // → { b2b: [], b2c: [], exports: [], hsnSummary: [], totals: {...}, invoiceCount }
  const { data: gstr1 } = useQuery({ queryKey: ['gstr1', month, year], queryFn: () => api.gst.getGSTR1({ month, year }), select: r => r.data.data, enabled: tab === 'gstr1' });
  // → { outwardSupplies: {taxableValue,cgst,sgst,igst,total}, inwardSupplies: {cgst,sgst,igst,total}, netGSTLiability: {...}, dueDate }
  const { data: gstr3b } = useQuery({ queryKey: ['gstr3b', month, year], queryFn: () => api.gst.getGSTR3B({ month, year }), select: r => r.data.data, enabled: tab === 'gstr3b' });
  // → HSNCode[] { code, description, gstRate, isActive }
  const { data: hsn } = useQuery({ queryKey: ['hsn-codes'], queryFn: () => api.gst.listHSN(), select: r => (r.data.data || []) as any[], enabled: tab === 'hsn' });

  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const outputTotal = num(summary?.outputTax?.total);
  const inputTotal = num(summary?.inputTax?.total);
  const netPayable = num(summary?.netGSTPayable);
  const taxSplit = [
    { label: 'Output GST (on sales)', taxable: num(summary?.taxableAmount), cgst: num(summary?.outputTax?.cgst), sgst: num(summary?.outputTax?.sgst), igst: num(summary?.outputTax?.igst), total: outputTotal },
    { label: 'Input GST (on purchases)', taxable: null, cgst: num(summary?.inputTax?.cgst), sgst: num(summary?.inputTax?.sgst), igst: num(summary?.inputTax?.igst), total: inputTotal },
  ];

  const gstr1Rows: any[] = [
    ...(gstr1?.b2b || []).map((r: any) => ({ ...r, kind: 'B2B' })),
    ...(gstr1?.b2c || []).map((r: any) => ({ ...r, kind: 'B2C' })),
    ...(gstr1?.exports || []).map((r: any) => ({ ...r, kind: 'Export' })),
  ].sort((a, b) => String(a.invoiceDate).localeCompare(String(b.invoiceDate)));

  const net3b = num(gstr3b?.netGSTLiability?.total);
  const periodSlug = `${year}-${pad(month)}`;

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
              {years.map(y => <option key={y} value={y}>{y}</option>)}
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
            <Card className="p-5"><p className="text-sm text-gray-500">Output GST (Sales)</p><p className="text-2xl font-bold text-green-600 mt-1">{formatCurrency(outputTotal)}</p></Card>
            <Card className="p-5"><p className="text-sm text-gray-500">Input GST (Purchases)</p><p className="text-2xl font-bold text-blue-600 mt-1">{formatCurrency(inputTotal)}</p></Card>
            <Card className="p-5">
              <p className="text-sm text-gray-500">{netPayable >= 0 ? 'Net GST Payable' : 'Input credit carried forward'}</p>
              <p className={`text-2xl font-bold mt-1 ${netPayable > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(Math.abs(netPayable))}</p>
              {netPayable > 0 && <div className="flex items-center gap-1 mt-2 text-xs text-red-500"><AlertCircle className="w-3 h-3" /> Payment due by 20 {months[month % 12]}</div>}
            </Card>
          </div>

          <Card className="p-5">
            <h3 className="font-semibold mb-4">GST Breakup — {months[month-1]} {year}</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-gray-200 dark:border-gray-700">{['', 'Taxable Amount', 'CGST', 'SGST', 'IGST', 'Total Tax'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-2">{h}</th>)}</tr></thead>
                <tbody>
                  {taxSplit.map(r => (
                    <tr key={r.label} className="border-b border-gray-100 dark:border-gray-700">
                      <td className="px-4 py-2 font-medium">{r.label}</td>
                      <td className="px-4 py-2">{r.taxable === null ? '-' : formatCurrency(r.taxable)}</td>
                      <td className="px-4 py-2">{formatCurrency(r.cgst)}</td>
                      <td className="px-4 py-2">{formatCurrency(r.sgst)}</td>
                      <td className="px-4 py-2">{formatCurrency(r.igst)}</td>
                      <td className="px-4 py-2 font-semibold">{formatCurrency(r.total)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-300 dark:border-gray-600 font-bold">
                    <td className="px-4 py-2">Net (output − input)</td>
                    <td className="px-4 py-2">-</td>
                    <td className="px-4 py-2">{formatCurrency(taxSplit[0].cgst - taxSplit[1].cgst)}</td>
                    <td className="px-4 py-2">{formatCurrency(taxSplit[0].sgst - taxSplit[1].sgst)}</td>
                    <td className="px-4 py-2">{formatCurrency(taxSplit[0].igst - taxSplit[1].igst)}</td>
                    <td className="px-4 py-2">{formatCurrency(netPayable)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-3">Sales {formatCurrency(num(summary?.totalSales))} · Purchases {formatCurrency(num(summary?.totalPurchases))} (including tax)</p>
          </Card>
        </div>
      )}

      {tab === 'gstr1' && (
        <Card className="p-5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">GSTR-1 (Outward Supplies) — {months[month-1]} {year}</h3>
            <Button variant="secondary" size="sm" disabled={!gstr1} onClick={() => downloadJSON(`GSTR1-${periodSlug}.json`, gstr1)}><Download className="w-4 h-4" /> Download JSON</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700">{['Invoice #', 'Customer', 'GSTIN', 'Date', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-3 py-2">{h}</th>)}</tr></thead>
              <tbody>
                {gstr1Rows.map((inv: any) => (
                  <tr key={inv.invoiceNumber} className="border-b border-gray-100 dark:border-gray-700 text-sm">
                    <td className="px-3 py-2">{inv.invoiceNumber}</td>
                    <td className="px-3 py-2">{inv.customerName || 'Walk-in customer'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{inv.gstin || inv.kind}</td>
                    <td className="px-3 py-2">{formatDate(inv.invoiceDate)}</td>
                    <td className="px-3 py-2">{formatCurrency(num(inv.taxableValue))}</td>
                    <td className="px-3 py-2">{formatCurrency(num(inv.cgst))}</td>
                    <td className="px-3 py-2">{formatCurrency(num(inv.sgst))}</td>
                    <td className="px-3 py-2">{formatCurrency(num(inv.igst))}</td>
                    <td className="px-3 py-2 font-semibold">{formatCurrency(num(inv.invoiceValue))}</td>
                  </tr>
                ))}
                {gstr1 && !gstr1Rows.length && <tr><td colSpan={9} className="text-center py-8 text-gray-500">No invoices for this period</td></tr>}
                {gstr1Rows.length > 0 && (
                  <tr className="border-t-2 border-gray-300 dark:border-gray-600 font-bold text-sm">
                    <td className="px-3 py-2" colSpan={4}>Total ({gstr1.invoiceCount} {gstr1.invoiceCount === 1 ? 'invoice' : 'invoices'})</td>
                    <td className="px-3 py-2">{formatCurrency(num(gstr1.totals?.taxableValue))}</td>
                    <td className="px-3 py-2">{formatCurrency(num(gstr1.totals?.cgst))}</td>
                    <td className="px-3 py-2">{formatCurrency(num(gstr1.totals?.sgst))}</td>
                    <td className="px-3 py-2">{formatCurrency(num(gstr1.totals?.igst))}</td>
                    <td className="px-3 py-2">{formatCurrency(num(gstr1.totals?.invoiceValue))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'gstr3b' && (
        <Card className="p-5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">GSTR-3B Summary — {months[month-1]} {year}</h3>
            <Button variant="secondary" size="sm" disabled={!gstr3b} onClick={() => downloadJSON(`GSTR3B-${periodSlug}.json`, gstr3b)}><Download className="w-4 h-4" /> Download</Button>
          </div>
          <div className="space-y-3 max-w-md">
            <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700"><span className="text-gray-600 dark:text-gray-400">3.1 Outward taxable supplies</span><span className="font-semibold">{formatCurrency(num(gstr3b?.outwardSupplies?.taxableValue))}</span></div>
            <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700"><span className="text-gray-600 dark:text-gray-400">3.1 Tax on outward supplies</span><span className="font-semibold">{formatCurrency(num(gstr3b?.outwardSupplies?.total))}</span></div>
            <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700"><span className="text-gray-600 dark:text-gray-400">4 ITC Available</span><span className="font-semibold">{formatCurrency(num(gstr3b?.inwardSupplies?.total))}</span></div>
            <div className="flex justify-between py-2 border-t-2 border-gray-300 font-bold"><span>{net3b >= 0 ? 'Net Tax Payable' : 'ITC carried forward'}</span><span className={net3b > 0 ? 'text-red-600' : 'text-green-600'}>{formatCurrency(Math.abs(net3b))}</span></div>
            {gstr3b?.dueDate && <p className="text-xs text-gray-500">Due by {formatDate(gstr3b.dueDate)}</p>}
          </div>
        </Card>
      )}

      {tab === 'hsn' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700">{['HSN/SAC Code', 'Description', 'GST Rate', 'Status'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}</tr></thead>
              <tbody>
                {(hsn || []).map((h: any) => (
                  <tr key={h.id} className="border-b border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-3 font-medium text-orange-600">{h.code}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{h.description || '-'}</td>
                    <td className="px-4 py-3 text-sm">{h.gstRate == null ? '-' : `${Number(h.gstRate)}%`}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{h.isActive === false ? 'Inactive' : 'Active'}</td>
                  </tr>
                ))}
                {hsn && !hsn.length && <tr><td colSpan={4} className="text-center py-8 text-gray-500">No HSN codes configured</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
