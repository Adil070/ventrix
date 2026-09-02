'use client';

import { useState } from 'react';
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

const PurchaseSchema = z.object({
  supplierId: z.string().min(1, 'Supplier required'),
  purchaseDate: z.string().min(1, 'Date required'),
  dueDate: z.string().optional(),
  billNumber: z.string().optional(),
  paymentMode: z.enum(['CASH', 'BANK', 'UPI', 'CHEQUE', 'CREDIT', 'NEFT', 'RTGS']).default('CREDIT'),
  items: z.array(z.object({
    productId: z.string().min(1, 'Product required'),
    description: z.string().optional(),
    quantity: z.coerce.number().min(0.01),
    unitPrice: z.coerce.number().min(0),
    taxRate: z.coerce.number().min(0).default(18),
    discount: z.coerce.number().min(0).default(0),
  })).min(1, 'At least one item required'),
  notes: z.string().optional(),
  amountPaid: z.coerce.number().min(0).default(0),
});

type PurchaseForm = z.infer<typeof PurchaseSchema>;

export default function NewPurchasePage() {
  const router = useRouter();

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-simple'],
    queryFn: () => api.suppliers.list({ limit: 200 }),
    select: r => r.data.data?.suppliers || [],
  });

  const { data: products } = useQuery({
    queryKey: ['products-simple'],
    queryFn: () => api.products.list({ limit: 200 }),
    select: r => r.data.data?.products || [],
  });

  const { register, handleSubmit, control, watch, setValue, formState: { errors } } = useForm<PurchaseForm>({
    resolver: zodResolver(PurchaseSchema),
    defaultValues: {
      purchaseDate: new Date().toISOString().split('T')[0],
      paymentMode: 'CREDIT',
      items: [{ productId: '', quantity: 1, unitPrice: 0, taxRate: 18, discount: 0 }],
      amountPaid: 0,
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  const watchedItems = watch('items');
  const amountPaid = watch('amountPaid') || 0;

  const totals = watchedItems.reduce((acc, item) => {
    const subtotal = (item.quantity || 0) * (item.unitPrice || 0);
    const discountAmt = subtotal * ((item.discount || 0) / 100);
    const taxable = subtotal - discountAmt;
    const tax = taxable * ((item.taxRate || 0) / 100);
    return { subtotal: acc.subtotal + taxable, tax: acc.tax + tax, total: acc.total + taxable + tax };
  }, { subtotal: 0, tax: 0, total: 0 });

  const mutation = useMutation({
    mutationFn: (data: PurchaseForm) => api.purchases.create(data),
    onSuccess: () => {
      toast.success('Purchase bill recorded!');
      router.push('/purchases');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to record purchase'),
  });

  const handleProductChange = (index: number, productId: string) => {
    const product = products?.find((p: any) => p.id === productId);
    if (product) {
      setValue(`items.${index}.unitPrice`, product.purchasePrice || product.costPrice || 0);
      setValue(`items.${index}.taxRate`, product.taxRate || 18);
    }
  };

  const inputCls = 'w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none';

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        title="Record Purchase Bill"
        subtitle="Add a new purchase from supplier"
        actions={
          <Button variant="secondary" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
        }
      />

      <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-6">
        {/* Supplier & Dates */}
        <Card className="p-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Bill Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Supplier *</label>
              <select {...register('supplierId')} className={inputCls}>
                <option value="">Select supplier...</option>
                {suppliers?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {errors.supplierId && <p className="text-red-500 text-xs mt-1">{errors.supplierId.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bill Number</label>
              <input {...register('billNumber')} className={inputCls} placeholder="Supplier's bill no." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Mode</label>
              <select {...register('paymentMode')} className={inputCls}>
                {['CASH', 'BANK', 'UPI', 'CHEQUE', 'CREDIT', 'NEFT', 'RTGS'].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Purchase Date *</label>
              <input {...register('purchaseDate')} type="date" className={inputCls} />
              {errors.purchaseDate && <p className="text-red-500 text-xs mt-1">{errors.purchaseDate.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Due Date</label>
              <input {...register('dueDate')} type="date" className={inputCls} />
            </div>
          </div>
        </Card>

        {/* Line Items */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Items</h2>
            <Button type="button" variant="secondary" size="sm" onClick={() => append({ productId: '', quantity: 1, unitPrice: 0, taxRate: 18, discount: 0 })}>
              <Plus className="w-4 h-4" /> Add Item
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  {['Product', 'Description', 'Qty', 'Unit Price', 'Tax %', 'Disc %', 'Amount', ''].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 pb-3 pr-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {fields.map((field, i) => {
                  const item = watchedItems[i] || {};
                  const subtotal = (item.quantity || 0) * (item.unitPrice || 0);
                  const discountAmt = subtotal * ((item.discount || 0) / 100);
                  const taxable = subtotal - discountAmt;
                  const lineTotal = taxable + taxable * ((item.taxRate || 0) / 100);

                  return (
                    <tr key={field.id} className="py-2">
                      <td className="py-2 pr-3 min-w-[180px]">
                        <select
                          {...register(`items.${i}.productId`)}
                          className={inputCls}
                          onChange={e => { register(`items.${i}.productId`).onChange(e); handleProductChange(i, e.target.value); }}
                        >
                          <option value="">Select product...</option>
                          {products?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        {errors.items?.[i]?.productId && <p className="text-red-500 text-xs mt-1">{errors.items[i]?.productId?.message}</p>}
                      </td>
                      <td className="py-2 pr-3 min-w-[140px]">
                        <input {...register(`items.${i}.description`)} className={inputCls} placeholder="Optional" />
                      </td>
                      <td className="py-2 pr-3 w-20">
                        <input {...register(`items.${i}.quantity`)} type="number" min="0.01" step="0.01" className={inputCls} />
                      </td>
                      <td className="py-2 pr-3 w-28">
                        <input {...register(`items.${i}.unitPrice`)} type="number" min="0" step="0.01" className={inputCls} />
                      </td>
                      <td className="py-2 pr-3 w-20">
                        <input {...register(`items.${i}.taxRate`)} type="number" min="0" max="100" className={inputCls} />
                      </td>
                      <td className="py-2 pr-3 w-20">
                        <input {...register(`items.${i}.discount`)} type="number" min="0" max="100" className={inputCls} />
                      </td>
                      <td className="py-2 pr-3 w-28 text-sm font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                        {formatCurrency(lineTotal)}
                      </td>
                      <td className="py-2">
                        {fields.length > 1 && (
                          <button type="button" onClick={() => remove(i)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {errors.items && typeof errors.items === 'object' && 'message' in errors.items && (
            <p className="text-red-500 text-xs mt-2">{errors.items.message as string}</p>
          )}
        </Card>

        {/* Totals + Notes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="p-6">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Notes</h2>
            <textarea {...register('notes')} rows={4} className={inputCls} placeholder="Internal notes or references..." />
          </Card>

          <Card className="p-6">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-600 dark:text-gray-400">
                <span>Subtotal (after discount)</span>
                <span>{formatCurrency(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between text-gray-600 dark:text-gray-400">
                <span>Tax (GST)</span>
                <span>{formatCurrency(totals.tax)}</span>
              </div>
              <div className="flex justify-between font-bold text-gray-900 dark:text-white text-base pt-2 border-t border-gray-200 dark:border-gray-700">
                <span>Grand Total</span>
                <span>{formatCurrency(totals.total)}</span>
              </div>
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount Paid</label>
                <input {...register('amountPaid')} type="number" min="0" step="0.01" className={inputCls} />
              </div>
              <div className="flex justify-between text-red-600 font-semibold pt-2">
                <span>Balance Due</span>
                <span>{formatCurrency(Math.max(0, totals.total - amountPaid))}</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pb-6">
          <Button variant="secondary" type="button" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending}>
            Record Purchase Bill
          </Button>
        </div>
      </form>
    </div>
  );
}
