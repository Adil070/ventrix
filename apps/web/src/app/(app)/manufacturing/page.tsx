'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { dropEmpty, today } from '@/lib/business';
import { PageHeader, Button, Card, EmptyState, StatusBadge } from '@/components/shared';
import { Plus, Play, CheckCircle } from 'lucide-react';
import { useForm, useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';

// POST /manufacturing/bom expects materials[].productId (not materialProductId).
const BOMSchema = z.object({
  productId: z.string().min(1, 'Pick the finished item'),
  name: z.string().min(1, 'Enter a name'),
  quantity: z.coerce.number().positive('Enter a quantity above 0'),
  materials: z.array(z.object({ productId: z.string().min(1, 'Pick a material'), quantity: z.coerce.number().positive('Qty above 0') })).min(1),
}).refine(d => d.materials.every(m => m.productId !== d.productId), { path: ['materials'], message: 'The finished item cannot also be one of its materials' });

// POST /manufacturing/orders expects productId, bomId, quantity, scheduledDate.
const OrderSchema = z.object({
  bomId: z.string().min(1, 'Pick a bill of materials'),
  quantity: z.coerce.number().positive('Enter a quantity above 0'),
  scheduledDate: z.string().min(1, 'Pick a date'),
  notes: z.string().optional(),
});

// ProductionOrderStatus: DRAFT, IN_PROGRESS, COMPLETED, CANCELLED
const ORDER_STATUS_TEXT: Record<string, string> = { DRAFT: 'Planned', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };

function apiError(e: any, fallback: string) {
  const d = e?.response?.data;
  const first = (d?.errors || d?.details || [])[0];
  return first?.message ? `${d.message}: ${first.field ? first.field + ' - ' : ''}${first.message}` : d?.message || d?.error || fallback;
}

const qty = (v: any) => +Number(v || 0).toFixed(3);

export default function ManufacturingPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'bom' | 'orders'>('bom');
  const [showBOMForm, setShowBOMForm] = useState(false);
  const [showOrderForm, setShowOrderForm] = useState(false);

  // GET /manufacturing/bom -> data: [...] (plain array, rows carry components[] not materials[])
  const { data: boms, isLoading: bomLoading } = useQuery({ queryKey: ['boms'], queryFn: () => api.manufacturing.listBOM(), select: r => (Array.isArray(r.data.data) ? r.data.data : []) as any[] });
  // GET /manufacturing/orders -> paginatedResponse: data: [...], pagination: { total, ... }
  const { data: orders, isLoading: ordersLoading } = useQuery({ queryKey: ['production-orders'], queryFn: () => api.manufacturing.listOrders({ limit: 100 }), select: r => ({ rows: (Array.isArray(r.data.data) ? r.data.data : []) as any[], total: Number(r.data.pagination?.total || 0) }), enabled: tab === 'orders' });
  const { data: products } = useQuery({ queryKey: ['products-simple'], queryFn: () => api.products.list({ limit: 200 }), select: r => r.data.data?.products || [] });
  const goods = (products || []).filter((p: any) => p.type !== 'SERVICE');

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<z.infer<typeof BOMSchema>>({ resolver: zodResolver(BOMSchema), defaultValues: { quantity: 1, materials: [{ productId: '', quantity: 1 }] } });
  const { fields, append, remove } = useFieldArray({ control, name: 'materials' });
  const { register: regOrder, handleSubmit: handleOrder, reset: resetOrder, formState: { errors: orderErr } } = useForm<z.infer<typeof OrderSchema>>({ resolver: zodResolver(OrderSchema) });

  const refreshStock = () => ['products', 'products-simple', 'inventory-summary', 'inventory-movements'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));

  const createBOMMut = useMutation({
    mutationFn: (d: z.infer<typeof BOMSchema>) => api.manufacturing.createBOM(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['boms'] }); toast.success('Bill of materials created'); setShowBOMForm(false); reset(); },
    onError: (e: any) => toast.error(apiError(e, 'Could not create the bill of materials')),
  });

  const createOrderMut = useMutation({
    mutationFn: (d: z.infer<typeof OrderSchema>) => {
      const bom = (boms || []).find((b: any) => b.id === d.bomId);
      return api.manufacturing.createOrder(dropEmpty({ ...d, productId: bom?.productId }));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['production-orders'] }); toast.success('Production order created'); setShowOrderForm(false); resetOrder(); },
    onError: (e: any) => toast.error(apiError(e, 'Could not create the production order')),
  });

  const startOrderMut = useMutation({
    mutationFn: (id: string) => api.manufacturing.startOrder(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['production-orders'] }); toast.success('Production started'); },
    onError: (e: any) => toast.error(apiError(e, 'Could not start production')),
  });

  const completeOrderMut = useMutation({
    mutationFn: (id: string) => api.manufacturing.completeOrder(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['production-orders'] }); refreshStock(); toast.success('Production completed! Stock updated.'); },
    onError: (e: any) => toast.error(apiError(e, 'Could not complete production')),
  });

  const openOrderForm = () => { resetOrder({ bomId: '', quantity: 1, scheduledDate: today(), notes: '' }); setShowOrderForm(true); };

  const inputCls = "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none";

  return (
    <div className="space-y-6">
      <PageHeader title="Manufacturing" subtitle="Bill of Materials and Production Orders"
        actions={tab === 'bom'
          ? <Button size="sm" onClick={() => { reset({ quantity: 1, materials: [{ productId: '', quantity: 1 }] }); setShowBOMForm(true); }}><Plus className="w-4 h-4" /> Create BOM</Button>
          : <Button size="sm" disabled={!boms?.length} onClick={openOrderForm}><Plus className="w-4 h-4" /> New production order</Button>}
      />

      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        {[['bom', 'Bill of Materials'], ['orders', 'Production Orders']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key as any)} className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === key ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{label}</button>
        ))}
      </div>

      {tab === 'bom' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700">{['BOM Name', 'Product', 'Output Qty', 'Materials', 'Created'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}</tr></thead>
              <tbody>
                {bomLoading && Array(4).fill(0).map((_, i) => <tr key={i}><td colSpan={5}><div className="h-10 bg-gray-100 dark:bg-gray-700 animate-pulse m-3 rounded" /></td></tr>)}
                {(boms || []).map((b: any) => (
                  <tr key={b.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{b.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{b.product?.name}</td>
                    <td className="px-4 py-3 text-sm">{qty(b.quantity)}{b.unit ? ` ${b.unit}` : ''}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{(b.components || []).map((c: any) => `${qty(c.quantity)} × ${c.product?.name || '?'}`).join(', ') || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDate(b.createdAt)}</td>
                  </tr>
                ))}
                {!bomLoading && !boms?.length && <tr><td colSpan={5}><EmptyState title="No Bill of Materials" description="Create BOMs to enable production tracking" action={<Button size="sm" onClick={() => setShowBOMForm(true)}><Plus className="w-4 h-4" /> Create BOM</Button>} /></td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'orders' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700">{['Order #', 'Product', 'Quantity', 'Scheduled', 'Status', 'Actions'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}</tr></thead>
              <tbody>
                {ordersLoading && Array(4).fill(0).map((_, i) => <tr key={i}><td colSpan={6}><div className="h-10 bg-gray-100 dark:bg-gray-700 animate-pulse m-3 rounded" /></td></tr>)}
                {(orders?.rows || []).map((o: any) => (
                  <tr key={o.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 font-medium text-orange-600">{o.orderNumber}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{o.bom?.product?.name || '-'}{o.bom?.name && <p className="text-xs text-gray-400">{o.bom.name}</p>}</td>
                    <td className="px-4 py-3 text-sm">{o.status === 'COMPLETED' ? qty(o.producedQuantity) : qty(o.plannedQuantity)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDate(o.plannedStartDate)}</td>
                    <td className="px-4 py-3"><StatusBadge status={o.status} label={ORDER_STATUS_TEXT[o.status]} /></td>
                    <td className="px-4 py-3">
                      {o.status === 'DRAFT' && <Button variant="secondary" size="sm" loading={startOrderMut.isPending && startOrderMut.variables === o.id} onClick={() => startOrderMut.mutate(o.id)}><Play className="w-3.5 h-3.5" /> Start</Button>}
                      {o.status === 'IN_PROGRESS' && <Button size="sm" loading={completeOrderMut.isPending && completeOrderMut.variables === o.id} onClick={() => { if (confirm('Mark as complete? This uses up the materials and adds the finished items to stock.')) completeOrderMut.mutate(o.id); }}><CheckCircle className="w-3.5 h-3.5" /> Complete</Button>}
                    </td>
                  </tr>
                ))}
                {!ordersLoading && !orders?.rows?.length && <tr><td colSpan={6}><EmptyState title="No production orders" description={boms?.length ? 'Create a production order from a BOM' : 'Create a bill of materials first, then plan production from it'} action={boms?.length ? <Button size="sm" onClick={openOrderForm}><Plus className="w-4 h-4" /> New production order</Button> : undefined} /></td></tr>}
              </tbody>
            </table>
          </div>
          {(orders?.total || 0) > (orders?.rows?.length || 0) && <p className="px-4 py-3 text-sm text-gray-500 border-t border-gray-200 dark:border-gray-700">Showing the latest {orders!.rows.length} of {orders!.total} orders.</p>}
        </Card>
      )}

      {showBOMForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Create Bill of Materials</h2>
              <button onClick={() => { setShowBOMForm(false); reset(); }}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleSubmit(d => createBOMMut.mutate(d))} className="p-6 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">BOM Name *</label><input {...register('name')} className={inputCls} placeholder="Product v1 BOM" />{errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}</div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Output Qty</label><input {...register('quantity')} type="number" step="0.001" className={inputCls} />{errors.quantity && <p className="text-red-500 text-xs mt-1">{errors.quantity.message}</p>}</div>
                <div className="col-span-3"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Finished Product *</label><select {...register('productId')} className={inputCls}><option value="">Select product</option>{goods.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>{errors.productId && <p className="text-red-500 text-xs mt-1">{errors.productId.message}</p>}</div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2"><h4 className="font-medium text-gray-900 dark:text-white">Raw Materials</h4><Button type="button" variant="secondary" size="sm" onClick={() => append({ productId: '', quantity: 1 })}><Plus className="w-4 h-4" /> Add Material</Button></div>
                {fields.map((f, i) => (
                  <div key={f.id} className="flex gap-3 mb-2">
                    <select {...register(`materials.${i}.productId`)} className={`${inputCls} flex-1`}><option value="">Select material</option>{goods.map((p: any) => <option key={p.id} value={p.id}>{p.name} (Stock: {qty(p.openingStock)})</option>)}</select>
                    <input {...register(`materials.${i}.quantity`)} type="number" step="0.001" placeholder="Qty" className={`${inputCls} w-24`} />
                    {fields.length > 1 && <button type="button" onClick={() => remove(i)} className="text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>}
                  </div>
                ))}
                {errors.materials && <p className="text-red-500 text-xs mt-1">{errors.materials.message || errors.materials.root?.message || 'Pick a material and quantity on every row'}</p>}
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <Button variant="secondary" type="button" onClick={() => { setShowBOMForm(false); reset(); }}>Cancel</Button>
                <Button type="submit" loading={createBOMMut.isPending}>Create BOM</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showOrderForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">New production order</h2>
              <button onClick={() => { setShowOrderForm(false); resetOrder(); }}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleOrder(d => createOrderMut.mutate(d))} className="p-6 space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bill of materials *</label><select {...regOrder('bomId')} className={inputCls}><option value="">Select BOM</option>{(boms || []).map((b: any) => <option key={b.id} value={b.id}>{b.name} → {b.product?.name}</option>)}</select>{orderErr.bomId && <p className="text-red-500 text-xs mt-1">{orderErr.bomId.message}</p>}</div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quantity to make *</label><input {...regOrder('quantity')} type="number" step="0.001" className={inputCls} />{orderErr.quantity && <p className="text-red-500 text-xs mt-1">{orderErr.quantity.message}</p>}</div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Planned date *</label><input {...regOrder('scheduledDate')} type="date" className={inputCls} />{orderErr.scheduledDate && <p className="text-red-500 text-xs mt-1">{orderErr.scheduledDate.message}</p>}</div>
              </div>
              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label><input {...regOrder('notes')} className={inputCls} placeholder="Optional" /></div>
              <div className="flex gap-3 justify-end pt-2">
                <Button variant="secondary" type="button" onClick={() => { setShowOrderForm(false); resetOrder(); }}>Cancel</Button>
                <Button type="submit" loading={createOrderMut.isPending}>Create order</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
