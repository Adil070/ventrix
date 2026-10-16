'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import Link from 'next/link';
import api from '@/lib/api';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { PAYMENT_MODES, type PaymentMode, paymentModeLabel, today, BILL_STATUS_TEXT } from '@/lib/business';
import { useOrganization } from '@/hooks/useOrganization';
import { StatusBadge, Button, Card, LoadingSpinner } from '@/components/shared';
import { ArrowLeft, Download, CreditCard, X, Printer, CheckCircle2, MessageCircle, Plus } from 'lucide-react';

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const justCreated = useSearchParams().get('created') === '1';
  const qc = useQueryClient();
  const { data: org } = useOrganization();
  const [showPayment, setShowPayment] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMode, setPayMode] = useState<PaymentMode>('CASH');
  const [payDate, setPayDate] = useState(today());
  const [payRef, setPayRef] = useState('');

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.invoices.get(id),
    select: r => r.data.data?.invoice ?? r.data.data,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['invoice', id] });
    qc.invalidateQueries({ queryKey: ['invoices'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['dues'] });
    qc.invalidateQueries({ queryKey: ['report-outstanding'] });
  };

  const payMut = useMutation({
    mutationFn: () => api.invoices.recordPayment(id, { amount: Number(payAmount), mode: payMode, paymentDate: payDate, referenceNumber: payRef || undefined }),
    onSuccess: () => { refresh(); toast.success('Payment recorded'); setShowPayment(false); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not record payment'),
  });

  const confirmMut = useMutation({
    mutationFn: () => api.invoices.confirm(id),
    onSuccess: () => { refresh(); toast.success('Bill finalised. Stock updated.'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not finalise'),
  });

  const handleDownloadPdf = async () => {
    try {
      const res = await api.invoices.generatePdf(id);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${invoice?.invoiceNumber || 'invoice'}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('Could not create the PDF');
    }
  };

  if (isLoading) return <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>;
  if (!invoice) {
    return (
      <div className="text-center py-20 space-y-3">
        <p className="text-gray-500">This bill could not be found.</p>
        <Link href="/billing/invoices" className="text-orange-600 font-medium hover:underline">Back to all sales</Link>
      </div>
    );
  }

  const total = Number(invoice.totalAmount || 0);
  const paid = Number(invoice.paidAmount || 0);
  const balance = Number(invoice.balanceAmount ?? total - paid);
  const canReceive = balance > 0 && !['DRAFT', 'CANCELLED'].includes(invoice.status);
  const customerName = invoice.customer?.name || 'Walk-in customer';

  const openPayment = () => { setPayAmount(String(balance)); setPayMode('CASH'); setPayDate(today()); setPayRef(''); setShowPayment(true); };

  const whatsappText = [
    `${org?.name || 'Bill'}: ${invoice.invoiceNumber}`,
    `Date: ${formatDate(invoice.invoiceDate)}`,
    `Total: ${formatCurrency(total)}`,
    balance > 0 ? `Balance due: ${formatCurrency(balance)}` : 'Paid in full. Thank you!',
  ].join('\n');
  const phone = invoice.customer?.mobile ? `91${invoice.customer.mobile}` : '';
  const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(whatsappText)}`;

  const inputCls = 'w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none';

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {justCreated && (
        <div className="no-print flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
          <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-green-800 dark:text-green-300">Sale saved: {formatCurrency(total)}</p>
            <p className="text-sm text-green-700 dark:text-green-400">{balance > 0 ? `${customerName} still owes ${formatCurrency(balance)}.` : 'Fully paid.'} Print it or share it with the customer.</p>
          </div>
          <Link href="/billing/invoices/new"><Button><Plus className="w-4 h-4" /> Next sale</Button></Link>
        </div>
      )}

      <div className="no-print flex flex-wrap items-center gap-3">
        <Link href="/billing/invoices" aria-label="Back to sales" className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"><ArrowLeft className="w-5 h-5" /></Link>
        <div className="mr-auto">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            {invoice.invoiceNumber} <StatusBadge status={invoice.status} label={BILL_STATUS_TEXT[invoice.status]} />
          </h1>
          <p className="text-sm text-gray-500">{customerName} · {formatDate(invoice.invoiceDate)}</p>
        </div>
        {invoice.status === 'DRAFT' && (
          <Button onClick={() => confirmMut.mutate()} loading={confirmMut.isPending}><CheckCircle2 className="w-4 h-4" /> Finalise bill</Button>
        )}
        {canReceive && <Button onClick={openPayment}><CreditCard className="w-4 h-4" /> Receive payment</Button>}
        <Button variant="secondary" onClick={() => window.print()}><Printer className="w-4 h-4" /> Print</Button>
        <a href={whatsappUrl} target="_blank" rel="noreferrer"><Button variant="secondary"><MessageCircle className="w-4 h-4" /> WhatsApp</Button></a>
        {invoice.status !== 'CANCELLED' && <Button variant="ghost" onClick={handleDownloadPdf}><Download className="w-4 h-4" /> PDF</Button>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2 p-6 print:border-0">
          <div className="flex justify-between gap-6 mb-8">
            <div>
              <p className="font-bold text-gray-900 dark:text-white text-lg">{org?.name}</p>
              {org?.gstin && <p className="text-sm text-gray-500">GSTIN: {org.gstin}</p>}
              {org?.phone && <p className="text-sm text-gray-500">{org.phone}</p>}
            </div>
            <div className="text-right">
              <p className="text-xl font-bold text-orange-500">{org?.gstin ? 'TAX INVOICE' : 'BILL'}</p>
              <p className="text-sm text-gray-500"># {invoice.invoiceNumber}</p>
              <p className="text-sm text-gray-500">{formatDate(invoice.invoiceDate)}</p>
            </div>
          </div>

          <div className="mb-6">
            <p className="text-xs font-semibold uppercase text-gray-400 mb-1">Bill to</p>
            <p className="font-semibold text-gray-900 dark:text-white">{customerName}</p>
            {invoice.customer?.mobile && <p className="text-sm text-gray-500">{invoice.customer.mobile}</p>}
            {invoice.customer?.gstin && <p className="text-sm text-gray-500">GSTIN: {invoice.customer.gstin}</p>}
            {invoice.dueDate && balance > 0 && <p className="text-sm text-gray-500 mt-1">Payment due by {formatDate(invoice.dueDate)}</p>}
          </div>

          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs font-semibold text-gray-500 uppercase">
                  <th className="py-2 pr-3">Item</th><th className="py-2 pr-3 text-right">Qty</th><th className="py-2 pr-3 text-right">Price</th><th className="py-2 pr-3 text-right">GST</th><th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {(invoice.items || []).map((item: any) => (
                  <tr key={item.id}>
                    <td className="py-2 pr-3">
                      <p className="font-medium text-gray-900 dark:text-white">{item.product?.name || item.description}</p>
                      {item.hsnCode && <p className="text-xs text-gray-400">HSN {item.hsnCode}</p>}
                    </td>
                    <td className="py-2 pr-3 text-right">{Number(item.quantity)}</td>
                    <td className="py-2 pr-3 text-right">{formatCurrency(item.unitPrice)}</td>
                    <td className="py-2 pr-3 text-right">{Number(item.taxRate || 0)}%</td>
                    <td className="py-2 text-right font-semibold">{formatCurrency(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <div className="w-64 space-y-1.5 text-sm">
              {Number(invoice.discountAmount) > 0 && <div className="flex justify-between text-green-600"><span>Discount</span><span>-{formatCurrency(invoice.discountAmount)}</span></div>}
              {Number(invoice.taxAmount) > 0 && <>
                <div className="flex justify-between text-gray-500"><span>Before tax</span><span>{formatCurrency(invoice.taxableAmount)}</span></div>
                {Number(invoice.cgstAmount) > 0 && <div className="flex justify-between text-gray-500"><span>CGST</span><span>{formatCurrency(invoice.cgstAmount)}</span></div>}
                {Number(invoice.sgstAmount) > 0 && <div className="flex justify-between text-gray-500"><span>SGST</span><span>{formatCurrency(invoice.sgstAmount)}</span></div>}
                {Number(invoice.igstAmount) > 0 && <div className="flex justify-between text-gray-500"><span>IGST</span><span>{formatCurrency(invoice.igstAmount)}</span></div>}
              </>}
              <div className="flex justify-between border-t border-gray-200 dark:border-gray-700 pt-2 font-bold text-base"><span>Total</span><span>{formatCurrency(total)}</span></div>
              {paid > 0 && <div className="flex justify-between text-green-600"><span>Paid</span><span>{formatCurrency(paid)}</span></div>}
              {balance > 0 && <div className="flex justify-between font-bold text-red-600"><span>Balance due</span><span>{formatCurrency(balance)}</span></div>}
            </div>
          </div>

          {invoice.notes && <p className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400">{invoice.notes}</p>}
          {invoice.termsAndConditions && <p className="mt-3 text-xs text-gray-500">{invoice.termsAndConditions}</p>}
        </Card>

        <div className="space-y-4 no-print">
          <Card className="p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Money</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Bill total</span><span className="font-semibold">{formatCurrency(total)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Received</span><span className="font-semibold text-green-600">{formatCurrency(paid)}</span></div>
              <div className="flex justify-between border-t border-gray-200 dark:border-gray-700 pt-2"><span className="font-medium">Still to collect</span><span className={cn('font-bold', balance > 0 ? 'text-red-600' : 'text-green-600')}>{formatCurrency(Math.max(balance, 0))}</span></div>
            </div>
            {canReceive && <Button className="w-full mt-4" onClick={openPayment}><CreditCard className="w-4 h-4" /> Receive payment</Button>}
          </Card>

          <Card className="p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Payments received</h3>
            {(invoice.payments || []).length === 0 ? <p className="text-sm text-gray-500">None yet</p> : (
              <div className="space-y-3">
                {invoice.payments.map((p: any) => (
                  <div key={p.id} className="flex justify-between text-sm">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">{formatDate(p.paymentDate)}</p>
                      <p className="text-xs text-gray-500">{paymentModeLabel(p.mode)}{p.referenceNumber ? ` · ${p.referenceNumber}` : ''}</p>
                    </div>
                    <span className="font-semibold text-green-600">{formatCurrency(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {showPayment && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Receive payment</h2>
                <p className="text-sm text-gray-500">{customerName} owes {formatCurrency(balance)}</p>
              </div>
              <button onClick={() => setShowPayment(false)} aria-label="Close"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); if (!(Number(payAmount) > 0)) return toast.error('Enter the amount received'); payMut.mutate(); }} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount received</label>
                <input inputMode="decimal" value={payAmount} onChange={e => setPayAmount(e.target.value)} className={cn(inputCls, 'text-lg font-semibold')} autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">How did they pay?</label>
                <div className="flex flex-wrap gap-2">
                  {PAYMENT_MODES.map(m => (
                    <button key={m.value} type="button" onClick={() => setPayMode(m.value)} className={cn('px-3 py-1.5 rounded-full text-sm border transition', payMode === m.value ? 'bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300')}>{m.label}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label><input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className={inputCls} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reference <span className="text-gray-400 font-normal">(optional)</span></label><input value={payRef} onChange={e => setPayRef(e.target.value)} className={inputCls} placeholder="UTR / cheque no." /></div>
              </div>
              <div className="flex gap-3 justify-end pt-1">
                <Button variant="secondary" type="button" onClick={() => setShowPayment(false)}>Cancel</Button>
                <Button type="submit" loading={payMut.isPending}>Save payment</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
