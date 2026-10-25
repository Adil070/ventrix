'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { today } from '@/lib/business';
import { PageHeader, Button, Card, StatusBadge, EmptyState } from '@/components/shared';
import { ItemPicker, itemPrice } from '@/components/shared/Pickers';
import { useOrgSettings } from '@/hooks/useOrganization';
import { Plus, X, FileText, Send, ArrowRight } from 'lucide-react';

const QuotationSchema = z.object({
  customerId: z.string().min(1, 'Customer required'),
  quotationDate: z.string().min(1, 'Required'),
  validUntil: z.string().min(1, 'Required'),
  notes: z.string().optional(),
  items: z.array(z.object({
    // Every line is a catalogue item, so converting the quotation to an invoice moves stock.
    productId: z.string().min(1, 'Pick an item'),
    description: z.string().min(1, 'Required'),
    quantity: z.number({ invalid_type_error: 'Required' }).positive('Must be more than 0'),
    unitPrice: z.number({ invalid_type_error: 'Required' }).min(0),
    taxRate: z.number().default(18),
  })).min(1),
});

type QuotationForm = z.infer<typeof QuotationSchema>;

// API validation errors look like { message, details | errors: [{ field, message }] } (routes that call schema.parse() inline use `errors`).
const apiError = (e: any, fallback: string) => {
  const d = e?.response?.data;
  const detail = d?.details?.[0] ?? d?.errors?.[0];
  return detail ? `${detail.field}: ${detail.message}` : d?.message || d?.error || fallback;
};

export default function QuotationsPage() {
  const qc = useQueryClient();
  const { experience } = useOrgSettings();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  // GET /quotations is paginated: rows are in data (an array), the count is in pagination.total.
  const { data, isLoading } = useQuery({
    queryKey: ['quotations', statusFilter],
    queryFn: () => api.quotations.list({ status: statusFilter || undefined, limit: 100 }),
    select: r => ({ quotations: (Array.isArray(r.data.data) ? r.data.data : []) as any[], total: Number(r.data.pagination?.total ?? 0) }),
  });
  const { data: customers } = useQuery({ queryKey: ['customers-all'], queryFn: () => api.customers.list({ limit: 500 }), select: r => r.data.data?.customers });

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<QuotationForm>({
    resolver: zodResolver(QuotationSchema),
    defaultValues: { quotationDate: today(), validUntil: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0], items: [{ productId: '', description: '', quantity: 1, unitPrice: 0, taxRate: 18 }] },
  });

  const items = watch('items');

  const createMut = useMutation({
    mutationFn: (d: QuotationForm) => api.quotations.create({
      customerId: d.customerId,
      quotationDate: d.quotationDate,
      validUntil: d.validUntil || undefined,
      notes: d.notes?.trim() || undefined,
      items: d.items.map(i => ({ productId: i.productId, description: i.description.trim(), quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), taxRate: Number(i.taxRate ?? 0) })),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quotations'] }); toast.success('Quotation created'); setShowForm(false); reset(); },
    onError: (e: any) => toast.error(apiError(e, 'Could not create quotation')),
  });

  const sendMut = useMutation({
    mutationFn: (id: string) => api.quotations.send(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quotations'] }); toast.success('Quotation marked as sent'); },
    onError: (e: any) => toast.error(apiError(e, 'Could not mark as sent')),
  });

  const convertMut = useMutation({
    mutationFn: (id: string) => api.quotations.convertToInvoice(id),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['quotations'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      toast.success(`Converted to invoice ${r?.data?.data?.invoiceNumber || ''}`.trim());
    },
    onError: (e: any) => toast.error(apiError(e, 'Could not convert to invoice')),
  });

  const inputCls = "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none";

  // Same maths as the API: qty x price, plus GST at the line's rate.
  const total = items?.reduce((s: number, i: any) => {
    const line = (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0);
    return s + line + line * (Number(i.taxRate) || 0) / 100;
  }, 0) || 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Quotations" subtitle={`${data?.total ?? 0} quotations`} actions={<Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Create Quotation</Button>} />

      {/* Filters */}
      <Card className="p-4">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={`${inputCls} w-48`}>
          <option value="">All Status</option>
          {['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>{['Quotation#', 'Customer', 'Date', 'Valid Until', 'Amount', 'Status', 'Actions'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {isLoading && <tr><td colSpan={7} className="text-center py-8 text-gray-500">Loading...</td></tr>}
              {(data?.quotations ?? []).map((q: any) => (
                <tr key={q.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-3 font-mono text-sm font-medium text-orange-600">{q.quotationNumber}</td>
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{q.customer?.name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{formatDate(q.quotationDate)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{formatDate(q.validUntil)}</td>
                  <td className="px-4 py-3 text-sm font-semibold">{formatCurrency(Number(q.totalAmount ?? 0))}</td>
                  <td className="px-4 py-3"><StatusBadge status={q.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {q.status === 'DRAFT' && <button onClick={() => sendMut.mutate(q.id)} disabled={sendMut.isPending} className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 flex items-center gap-1"><Send className="w-3 h-3" /> Mark sent</button>}
                      {(q.status === 'SENT' || q.status === 'ACCEPTED') && <button onClick={() => { if (confirm(`Create an invoice from ${q.quotationNumber}?`)) convertMut.mutate(q.id); }} disabled={convertMut.isPending} className="text-xs px-2 py-1 bg-green-50 text-green-600 rounded hover:bg-green-100 flex items-center gap-1"><ArrowRight className="w-3 h-3" /> Make invoice</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!isLoading && !data?.quotations.length && <tr><td colSpan={7} className="text-center py-8"><EmptyState title="No quotations" description="Create your first quotation" /></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Create Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Create Quotation</h2>
              <button onClick={() => { setShowForm(false); reset(); }}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleSubmit(d => createMut.mutate(d))} className="p-6 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-3"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Customer *</label>
                  <select {...register('customerId')} className={inputCls}><option value="">Select customer</option>{(customers || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                  {errors.customerId && <p className="text-xs text-red-500 mt-1">{errors.customerId.message}</p>}
                </div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label><input type="date" {...register('quotationDate')} className={inputCls} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valid Until</label><input type="date" {...register('validUntil')} className={inputCls} /></div>
              </div>

              {/* Items */}
              <div>
                <div className="flex justify-between items-center mb-2"><label className="text-sm font-medium text-gray-700 dark:text-gray-300">Items</label>
                  <button type="button" onClick={() => setValue('items', [...items, { productId: '', description: '', quantity: 1, unitPrice: 0, taxRate: 18 }])} className="text-xs text-orange-600 hover:text-orange-700">+ Add Item</button>
                </div>
                {items?.map((item: any, i: number) => (
                  <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-center">
                    <div className="col-span-5">
                      <ItemPicker
                        value={item.productId || null}
                        selectedLabel={item.description}
                        priceField="sellingPrice"
                        trackInventory={experience !== 'simple'}
                        onChange={opt => {
                          if (!opt) return;
                          const p = opt.data || {};
                          setValue(`items.${i}.productId`, opt.id, { shouldValidate: true });
                          setValue(`items.${i}.description`, opt.label);
                          setValue(`items.${i}.unitPrice`, itemPrice(p, 'sellingPrice'));
                          setValue(`items.${i}.taxRate`, Number(p.taxRate ?? 18));
                        }}
                      />
                    </div>
                    <div className="col-span-2"><input type="number" {...register(`items.${i}.quantity`, { valueAsNumber: true })} className={inputCls} placeholder="Qty" /></div>
                    <div className="col-span-2"><input type="number" step="0.01" {...register(`items.${i}.unitPrice`, { valueAsNumber: true })} className={inputCls} placeholder="Price" /></div>
                    <div className="col-span-2"><select {...register(`items.${i}.taxRate`, { valueAsNumber: true })} className={inputCls}>{[0, 5, 12, 18, 28].map(r => <option key={r} value={r}>{r}%</option>)}</select></div>
                    {items.length > 1 && <button type="button" onClick={() => setValue('items', items.filter((_: any, j: number) => j !== i))} className="text-red-500 text-xs">✕</button>}
                  </div>
                ))}
                {errors.items && <p className="text-xs text-red-500">Pick an item and enter a quantity and price on every line.</p>}
                <div className="text-right text-sm font-semibold text-gray-900 dark:text-white mt-2">Total (incl. GST): {formatCurrency(total)}</div>
              </div>

              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label><textarea {...register('notes')} rows={2} className={inputCls} /></div>
              <div className="flex gap-3 justify-end">
                <Button variant="secondary" type="button" onClick={() => { setShowForm(false); reset(); }}>Cancel</Button>
                <Button type="submit" loading={createMut.isPending}><FileText className="w-4 h-4" /> Create Quotation</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
