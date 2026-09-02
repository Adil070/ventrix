'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatDate, formatCurrency } from '@/lib/utils';
import { PageHeader, Button, Card, EmptyState, StatusBadge } from '@/components/shared';
import { Plus, Play, CheckCircle, Factory } from 'lucide-react';
import { useForm, useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';

const BOMSchema = z.object({
  productId: z.string().min(1, 'Product required'),
  name: z.string().min(1, 'BOM name required'),
  quantity: z.coerce.number().min(0.01),
  materials: z.array(z.object({ materialProductId: z.string().min(1), quantity: z.coerce.number().min(0.01) })).min(1),
});

export default function ManufacturingPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'bom' | 'orders'>('bom');
  const [showBOMForm, setShowBOMForm] = useState(false);

  const { data: boms, isLoading: bomLoading } = useQuery({ queryKey: ['boms'], queryFn: () => api.manufacturing.listBOM(), select: r => r.data.data });
  const { data: orders, isLoading: ordersLoading } = useQuery({ queryKey: ['production-orders'], queryFn: () => api.manufacturing.listOrders(), select: r => r.data.data, enabled: tab === 'orders' });
  const { data: products } = useQuery({ queryKey: ['products-simple'], queryFn: () => api.products.list({ limit: 200 }), select: r => r.data.data?.products || [] });

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<z.infer<typeof BOMSchema>>({ resolver: zodResolver(BOMSchema), defaultValues: { materials: [{ materialProductId: '', quantity: 1 }] } });
  const { fields, append, remove } = useFieldArray({ control, name: 'materials' });

  const createBOMMut = useMutation({
    mutationFn: (d: any) => api.manufacturing.createBOM(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['boms'] }); toast.success('BOM created'); setShowBOMForm(false); reset(); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const startOrderMut = useMutation({
    mutationFn: (id: string) => api.manufacturing.startOrder(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['production-orders'] }); toast.success('Production started'); },
  });

  const completeOrderMut = useMutation({
    mutationFn: (id: string) => api.manufacturing.completeOrder(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['production-orders'] }); toast.success('Production completed! Stock updated.'); },
  });

  const inputCls = "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none";

  return (
    <div className="space-y-6">
      <PageHeader title="Manufacturing" subtitle="Bill of Materials and Production Orders"
        actions={tab === 'bom' && <Button size="sm" onClick={() => { reset({ materials: [{ materialProductId: '', quantity: 1 }] }); setShowBOMForm(true); }}><Plus className="w-4 h-4" /> Create BOM</Button>}
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
                {(boms?.boms || []).map((b: any) => (
                  <tr key={b.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{b.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{b.product?.name}</td>
                    <td className="px-4 py-3 text-sm">{b.quantity} {b.product?.unit?.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{b.materials?.length || 0} items</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDate(b.createdAt)}</td>
                  </tr>
                ))}
                {!bomLoading && !boms?.boms?.length && <tr><td colSpan={5}><EmptyState title="No Bill of Materials" description="Create BOMs to enable production tracking" action={<Button size="sm" onClick={() => setShowBOMForm(true)}><Plus className="w-4 h-4" /> Create BOM</Button>} /></td></tr>}
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
                {(orders?.orders || []).map((o: any) => (
                  <tr key={o.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 font-medium text-orange-600">{o.orderNumber}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{o.product?.name}</td>
                    <td className="px-4 py-3 text-sm">{o.quantity}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDate(o.scheduledDate)}</td>
                    <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                    <td className="px-4 py-3">
                      {o.status === 'PLANNED' && <Button variant="secondary" size="sm" loading={startOrderMut.isPending} onClick={() => startOrderMut.mutate(o.id)}><Play className="w-3.5 h-3.5" /> Start</Button>}
                      {o.status === 'IN_PROGRESS' && <Button size="sm" loading={completeOrderMut.isPending} onClick={() => completeOrderMut.mutate(o.id)}><CheckCircle className="w-3.5 h-3.5" /> Complete</Button>}
                    </td>
                  </tr>
                ))}
                {!ordersLoading && !orders?.orders?.length && <tr><td colSpan={6}><EmptyState title="No production orders" description="Create a production order from a BOM" /></td></tr>}
              </tbody>
            </table>
          </div>
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
                <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">BOM Name *</label><input {...register('name')} className={inputCls} placeholder="Product v1 BOM" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Output Qty</label><input {...register('quantity')} type="number" step="0.001" className={inputCls} /></div>
                <div className="col-span-3"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Finished Product *</label><select {...register('productId')} className={inputCls}><option value="">Select product</option>{(products || []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2"><h4 className="font-medium text-gray-900 dark:text-white">Raw Materials</h4><Button type="button" variant="secondary" size="sm" onClick={() => append({ materialProductId: '', quantity: 1 })}><Plus className="w-4 h-4" /> Add Material</Button></div>
                {fields.map((f, i) => (
                  <div key={f.id} className="flex gap-3 mb-2">
                    <select {...register(`materials.${i}.materialProductId`)} className={`${inputCls} flex-1`}><option value="">Select material</option>{(products || []).map((p: any) => <option key={p.id} value={p.id}>{p.name} (Stock: {p.currentStock})</option>)}</select>
                    <input {...register(`materials.${i}.quantity`)} type="number" step="0.001" placeholder="Qty" className={`${inputCls} w-24`} />
                    {fields.length > 1 && <button type="button" onClick={() => remove(i)} className="text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>}
                  </div>
                ))}
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <Button variant="secondary" type="button" onClick={() => { setShowBOMForm(false); reset(); }}>Cancel</Button>
                <Button type="submit" loading={createBOMMut.isPending}>Create BOM</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
