'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import Link from 'next/link';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { StatusBadge, Button, Card, LoadingSpinner } from '@/components/shared';
import { ArrowLeft, Download, CreditCard, X, Printer, CheckCircle } from 'lucide-react';

const PaymentSchema = z.object({
  amount: z.number().min(0.01, 'Required'),
  paymentDate: z.string().min(1, 'Required'),
  paymentMode: z.string().min(1, 'Required'),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

type PaymentForm = z.infer<typeof PaymentSchema>;

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [showPayment, setShowPayment] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ['invoice', id], queryFn: () => api.invoices.get(id), select: r => r.data.data });
  const invoice = data?.invoice;

  const { register, handleSubmit, reset, formState: { errors } } = useForm<PaymentForm>({
    resolver: zodResolver(PaymentSchema),
    defaultValues: { paymentDate: new Date().toISOString().split('T')[0], paymentMode: 'CASH' },
  });

  const payMut = useMutation({
    mutationFn: (d: PaymentForm) => api.invoices.recordPayment(id, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['invoice', id] }); toast.success('Payment recorded'); setShowPayment(false); reset(); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const confirmMut = useMutation({
    mutationFn: () => api.invoices.confirm(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['invoice', id] }); toast.success('Invoice confirmed! Stock deducted.'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to confirm'),
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
      toast.error('Failed to generate PDF');
    }
  };

  const inputCls = "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none";

  if (isLoading) return <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>;
  if (!invoice) return <div className="text-center py-20 text-gray-500">Invoice not found</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/billing/invoices" className="text-gray-500 hover:text-gray-700"><ArrowLeft className="w-5 h-5" /></Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">{invoice.invoiceNumber} <StatusBadge status={invoice.status} /></h1>
            <p className="text-sm text-gray-500 mt-0.5">Invoice · {formatDate(invoice.invoiceDate)}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => window.print()}><Printer className="w-4 h-4" /> Print</Button>
          {invoice.status === 'DRAFT' && (
            <Button variant="secondary" size="sm" onClick={() => confirmMut.mutate()}><CheckCircle className="w-4 h-4" /> Confirm</Button>
          )}
          {invoice.status !== 'CANCELLED' && (
            <Button variant="secondary" size="sm" onClick={() => handleDownloadPdf()}><Download className="w-4 h-4" /> PDF</Button>
          )}
          {invoice.status !== 'PAID' && invoice.status !== 'CANCELLED' && invoice.status !== 'DRAFT' && (
            <Button size="sm" onClick={() => setShowPayment(true)}><CreditCard className="w-4 h-4" /> Record Payment</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Invoice */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6 print:shadow-none">
            {/* Invoice Header */}
            <div className="flex justify-between mb-8">
              <div>
                <h2 className="text-2xl font-bold text-orange-500 mb-1">INVOICE</h2>
                <p className="text-sm text-gray-500"># {invoice.invoiceNumber}</p>
              </div>
              <div className="text-right text-sm">
                <p className="font-bold text-gray-900 dark:text-white text-lg">{invoice.organization?.name}</p>
                <p className="text-gray-500">{invoice.organization?.gstin ? `GSTIN: ${invoice.organization.gstin}` : ''}</p>
              </div>
            </div>

            {/* Bill To / Details */}
            <div className="grid grid-cols-2 gap-8 mb-8">
              <div>
                <p className="text-xs font-semibold uppercase text-gray-400 mb-1">Bill To</p>
                <p className="font-semibold text-gray-900 dark:text-white">{invoice.customer?.name}</p>
                <p className="text-sm text-gray-500">{invoice.customer?.email}</p>
                <p className="text-sm text-gray-500">{invoice.customer?.mobile}</p>
                {invoice.customer?.gstin && <p className="text-sm text-gray-500">GSTIN: {invoice.customer.gstin}</p>}
              </div>
              <div className="text-right">
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between gap-8"><span className="text-gray-500">Invoice Date:</span><span className="font-medium">{formatDate(invoice.invoiceDate)}</span></div>
                  <div className="flex justify-between gap-8"><span className="text-gray-500">Due Date:</span><span className="font-medium">{formatDate(invoice.dueDate)}</span></div>
                  {invoice.invoiceType && <div className="flex justify-between gap-8"><span className="text-gray-500">Type:</span><span className="font-medium">{invoice.invoiceType}</span></div>}
                </div>
              </div>
            </div>

            {/* Items Table */}
            <div className="overflow-x-auto mb-6">
              <table className="w-full border border-gray-200 dark:border-gray-700 rounded-lg">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>{['#', 'Item', 'HSN/SAC', 'Qty', 'Rate', 'Disc%', 'Tax%', 'Amount'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 px-3 py-2">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {(invoice.items || []).map((item: any, i: number) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 text-sm text-gray-500">{i + 1}</td>
                      <td className="px-3 py-2"><p className="font-medium text-gray-900 dark:text-white text-sm">{item.product?.name || item.description}</p></td>
                      <td className="px-3 py-2 text-sm text-gray-500">{item.product?.hsnCode || '—'}</td>
                      <td className="px-3 py-2 text-sm">{item.quantity} {item.product?.unit?.symbol}</td>
                      <td className="px-3 py-2 text-sm">{formatCurrency(item.unitPrice)}</td>
                      <td className="px-3 py-2 text-sm">{item.discountPercent || 0}%</td>
                      <td className="px-3 py-2 text-sm">{item.taxRate}%</td>
                      <td className="px-3 py-2 text-sm font-semibold">{formatCurrency(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="flex justify-end">
              <div className="w-64 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatCurrency(invoice.subtotal)}</span></div>
                {invoice.discount > 0 && <div className="flex justify-between text-red-600"><span>Discount</span><span>- {formatCurrency(invoice.discount)}</span></div>}
                <div className="flex justify-between"><span className="text-gray-500">CGST</span><span>{formatCurrency(invoice.cgst)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">SGST</span><span>{formatCurrency(invoice.sgst)}</span></div>
                {invoice.igst > 0 && <div className="flex justify-between"><span className="text-gray-500">IGST</span><span>{formatCurrency(invoice.igst)}</span></div>}
                <div className="flex justify-between border-t border-gray-200 dark:border-gray-700 pt-2 font-bold text-base">
                  <span>Total</span><span className="text-orange-600">{formatCurrency(invoice.grandTotal)}</span>
                </div>
                {invoice.amountPaid > 0 && <div className="flex justify-between text-green-600"><span>Amount Paid</span><span>{formatCurrency(invoice.amountPaid)}</span></div>}
                <div className="flex justify-between font-bold"><span>Balance Due</span><span className="text-red-600">{formatCurrency(invoice.balanceDue || (invoice.grandTotal - invoice.amountPaid))}</span></div>
              </div>
            </div>

            {invoice.notes && <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700"><p className="text-xs font-semibold text-gray-400 uppercase mb-1">Notes</p><p className="text-sm text-gray-600">{invoice.notes}</p></div>}
            {invoice.terms && <div className="mt-3"><p className="text-xs font-semibold text-gray-400 uppercase mb-1">Terms & Conditions</p><p className="text-sm text-gray-600">{invoice.terms}</p></div>}
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Summary */}
          <Card className="p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Total</span><span className="font-semibold">{formatCurrency(invoice.grandTotal)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Paid</span><span className="font-semibold text-green-600">{formatCurrency(invoice.amountPaid)}</span></div>
              <div className="flex justify-between border-t border-gray-200 dark:border-gray-700 pt-2"><span className="font-medium">Balance</span><span className="font-bold text-red-600">{formatCurrency(invoice.balanceDue || (invoice.grandTotal - invoice.amountPaid))}</span></div>
            </div>
          </Card>

          {/* Payment History */}
          <Card className="p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Payments</h3>
            {(invoice.payments || []).length === 0 ? <p className="text-sm text-gray-500">No payments recorded</p> : (
              <div className="space-y-3">
                {(invoice.payments || []).map((p: any) => (
                  <div key={p.id} className="flex justify-between text-sm">
                    <div><p className="font-medium text-gray-900 dark:text-white">{formatDate(p.paymentDate)}</p><p className="text-xs text-gray-500">{p.paymentMode} · {p.reference}</p></div>
                    <span className="font-semibold text-green-600">{formatCurrency(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Record Payment Modal */}
      {showPayment && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Record Payment</h2>
              <button onClick={() => { setShowPayment(false); reset(); }}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleSubmit(d => payMut.mutate(d))} className="p-6 space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount *</label><input type="number" step="0.01" {...register('amount', { valueAsNumber: true })} className={inputCls} defaultValue={invoice.balanceDue || (invoice.grandTotal - invoice.amountPaid)} /></div>
              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Date</label><input type="date" {...register('paymentDate')} className={inputCls} /></div>
              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Mode</label>
                <select {...register('paymentMode')} className={inputCls}>{['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD', 'NEFT', 'RTGS'].map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}</select>
              </div>
              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reference#</label><input {...register('reference')} className={inputCls} placeholder="UTR, cheque#, etc." /></div>
              <div className="flex gap-3 justify-end">
                <Button variant="secondary" type="button" onClick={() => { setShowPayment(false); reset(); }}>Cancel</Button>
                <Button type="submit" loading={payMut.isPending}><CreditCard className="w-4 h-4" /> Record Payment</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
