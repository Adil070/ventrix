'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { Button, Card, PageHeader } from '@/components/shared';
import { Plus, Trash2, ArrowLeft } from 'lucide-react';

const InvoiceSchema = z.object({
  customerId: z.string().min(1, 'Customer required'),
  invoiceDate: z.string().min(1),
  dueDate: z.string().optional(),
  invoiceType: z.enum(['SALES', 'PROFORMA', 'CREDIT_NOTE', 'DEBIT_NOTE']).default('SALES'),
  paymentMode: z.enum(['CASH', 'BANK', 'UPI', 'CHEQUE', 'CREDIT', 'NEFT', 'RTGS']).default('CREDIT'),
  items: z.array(z.object({
    productId: z.string().min(1, 'Product required'),
    description: z.string().optional(),
    quantity: z.coerce.number().min(0.01),
    unitPrice: z.coerce.number().min(0),
    taxRate: z.coerce.number().min(0).default(18),
    discount: z.coerce.number().min(0).default(0),
    discountType: z.enum(['PERCENTAGE', 'AMOUNT']).default('PERCENTAGE'),
  })).min(1, 'At least one item required'),
  notes: z.string().optional(),
  termsAndConditions: z.string().optional(),
  amountPaid: z.coerce.number().min(0).default(0),
});

type InvoiceForm = z.infer<typeof InvoiceSchema>;

export default function NewInvoicePage() {
  const router = useRouter();
  const { data: customers } = useQuery({ queryKey: ['customers-simple'], queryFn: () => api.customers.list({ limit: 200 }), select: r => r.data.data?.customers || [] });
  const { data: products } = useQuery({ queryKey: ['products-simple'], queryFn: () => api.products.list({ limit: 200 }), select: r => r.data.data?.products || [] });

  const { register, handleSubmit, control, watch, setValue, formState: { errors } } = useForm<InvoiceForm>({
    resolver: zodResolver(InvoiceSchema),
    defaultValues: { invoiceDate: new Date().toISOString().split('T')[0], invoiceType: 'SALES', paymentMode: 'CREDIT', items: [{ productId: '', quantity: 1, unitPrice: 0, taxRate: 18, discount: 0, discountType: 'PERCENTAGE' }], amountPaid: 0 },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const items = watch('items');

  const createMut = useMutation({
    mutationFn: (d: InvoiceForm) => api.invoices.create(d),
    onSuccess: (res) => { toast.success('Invoice created!'); router.push(`/billing/invoices/${res.data.data.id}`); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to create invoice'),
  });

  // Auto-fill product price when selected
  const handleProductChange = (index: number, productId: string) => {
    const product = (products || []).find((p: any) => p.id === productId);
    if (product) {
      setValue(`items.${index}.unitPrice`, product.sellingPrice || 0);
      setValue(`items.${index}.taxRate`, product.taxRate || 18);
    }
  };

  // Calculate totals
  const calculateTotals = () => {
    let subtotal = 0, totalTax = 0, totalDiscount = 0;
    items.forEach(item => {
      const lineTotal = (item.quantity || 0) * (item.unitPrice || 0);
      let disc = 0;
      if (item.discountType === 'PERCENTAGE') disc = lineTotal * (item.discount || 0) / 100;
      else disc = item.discount || 0;
      const taxableAmt = lineTotal - disc;
      const tax = taxableAmt * (item.taxRate || 0) / 100;
      subtotal += taxableAmt;
      totalTax += tax;
      totalDiscount += disc;
    });
    return { subtotal, totalTax, totalDiscount, total: subtotal + totalTax };
  };

  const { subtotal, totalTax, totalDiscount, total } = calculateTotals();

  const inputClass = "w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-orange-500 outline-none";

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader title="Create Invoice"
        actions={<Button variant="secondary" size="sm" onClick={() => router.back()}><ArrowLeft className="w-4 h-4" /> Back</Button>}
      />

      <form onSubmit={handleSubmit(d => createMut.mutate(d))} className="space-y-6">
        {/* Header */}
        <Card className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Customer *</label>
              <select {...register('customerId')} className={inputClass}>
                <option value="">Select customer</option>
                {(customers || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {errors.customerId && <p className="text-red-500 text-xs mt-1">{errors.customerId.message}</p>}
            </div>
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Invoice Type</label>
              <select {...register('invoiceType')} className={inputClass}>{['SALES', 'PROFORMA', 'CREDIT_NOTE', 'DEBIT_NOTE'].map(t => <option key={t}>{t}</option>)}</select>
            </div>
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Mode</label>
              <select {...register('paymentMode')} className={inputClass}>{['CASH', 'BANK', 'UPI', 'CHEQUE', 'CREDIT', 'NEFT', 'RTGS'].map(m => <option key={m}>{m}</option>)}</select>
            </div>
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Invoice Date *</label>
              <input {...register('invoiceDate')} type="date" className={inputClass} />
            </div>
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Due Date</label>
              <input {...register('dueDate')} type="date" className={inputClass} />
            </div>
          </div>
        </Card>

        {/* Items */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 dark:text-white">Items</h3>
            <Button type="button" variant="secondary" size="sm" onClick={() => append({ productId: '', quantity: 1, unitPrice: 0, taxRate: 18, discount: 0, discountType: 'PERCENTAGE' })}><Plus className="w-4 h-4" /> Add Item</Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700">
                {['Product', 'Qty', 'Price', 'Disc%', 'Tax%', 'Amount', ''].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase pb-2 pr-3">{h}</th>)}
              </tr></thead>
              <tbody>
                {fields.map((field, idx) => {
                  const item = items[idx] || {};
                  const lineTotal = (item.quantity || 0) * (item.unitPrice || 0);
                  const disc = item.discountType === 'PERCENTAGE' ? lineTotal * (item.discount || 0) / 100 : (item.discount || 0);
                  const taxable = lineTotal - disc;
                  const tax = taxable * (item.taxRate || 0) / 100;
                  const amount = taxable + tax;
                  return (
                    <tr key={field.id} className="border-b border-gray-100 dark:border-gray-700">
                      <td className="py-2 pr-3 min-w-[180px]">
                        <select {...register(`items.${idx}.productId`)} onChange={e => handleProductChange(idx, e.target.value)} className={inputClass}>
                          <option value="">Select product</option>
                          {(products || []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </td>
                      <td className="py-2 pr-3 w-20"><input {...register(`items.${idx}.quantity`)} type="number" step="0.001" className={inputClass} /></td>
                      <td className="py-2 pr-3 w-28"><input {...register(`items.${idx}.unitPrice`)} type="number" step="0.01" className={inputClass} /></td>
                      <td className="py-2 pr-3 w-20"><input {...register(`items.${idx}.discount`)} type="number" step="0.01" className={inputClass} /></td>
                      <td className="py-2 pr-3 w-20">
                        <select {...register(`items.${idx}.taxRate`)} className={inputClass}>{[0,5,12,18,28].map(r => <option key={r} value={r}>{r}%</option>)}</select>
                      </td>
                      <td className="py-2 pr-3 w-28 text-right font-semibold text-sm">{formatCurrency(amount)}</td>
                      <td className="py-2 w-8">
                        {fields.length > 1 && <button type="button" onClick={() => remove(idx)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="mt-4 flex justify-end">
            <div className="w-64 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
              {totalDiscount > 0 && <div className="flex justify-between text-green-600"><span>Discount</span><span>-{formatCurrency(totalDiscount)}</span></div>}
              <div className="flex justify-between"><span className="text-gray-500">GST</span><span>{formatCurrency(totalTax)}</span></div>
              <div className="flex justify-between font-bold text-base border-t border-gray-200 dark:border-gray-600 pt-2"><span>Total</span><span>{formatCurrency(total)}</span></div>
              <div className="pt-2">
                <label className="block text-xs text-gray-500 mb-1">Amount Paid (₹)</label>
                <input {...register('amountPaid')} type="number" step="0.01" className={inputClass} />
              </div>
            </div>
          </div>
        </Card>

        {/* Notes */}
        <Card className="p-6">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label><textarea {...register('notes')} rows={3} className={inputClass} placeholder="Thank you for your business!" /></div>
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Terms & Conditions</label><textarea {...register('termsAndConditions')} rows={3} className={inputClass} placeholder="Payment due within 30 days..." /></div>
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          <Button variant="secondary" type="button" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" loading={createMut.isPending}>Create Invoice</Button>
        </div>
      </form>
    </div>
  );
}
