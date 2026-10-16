'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { dropEmpty, plural } from '@/lib/business';
import { PageHeader, Button, Card, EmptyState } from '@/components/shared';
import { Plus, X, Warehouse, Package } from 'lucide-react';

const WarehouseSchema = z.object({
  name: z.string().min(1, 'Required'),
  code: z.string().optional(),
  address: z.string().optional(),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  isDefault: z.boolean().default(false),
});

type WarehouseForm = z.infer<typeof WarehouseSchema>;

// The API stores address as a JSON object ({ line1, city, ... }); older rows may hold a plain string.
const addressText = (a: any) => !a ? '' : typeof a === 'string' ? a : ['line1', 'line2', 'city', 'state', 'pincode'].map(k => a[k]).filter(Boolean).join(', ') || Object.values(a).filter(v => typeof v === 'string').join(', ');

function apiError(e: any, fallback: string) {
  const d = e?.response?.data;
  const first = (d?.errors || d?.details || [])[0];
  return first?.message ? `${d.message}: ${first.field ? first.field + ' - ' : ''}${first.message}` : d?.message || fallback;
}

export default function WarehousePage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selectedWarehouse, setSelectedWarehouse] = useState<string | null>(null);

  // GET /warehouses -> { warehouses: [...] } (no total)
  const { data, isLoading } = useQuery({ queryKey: ['warehouses'], queryFn: () => api.warehouse.list(), select: r => r.data.data });
  const warehouses: any[] = data?.warehouses || [];
  // GET /warehouses/:id/stock -> one row per item: stockIn, stockOut (positive) and warehouseQuantity (net).
  const { data: stockData, isLoading: stockLoading } = useQuery({
    queryKey: ['warehouse-stock', selectedWarehouse],
    queryFn: () => api.warehouse.stock(selectedWarehouse!),
    enabled: !!selectedWarehouse,
    select: r => ({
      rows: ((r.data.data || []) as any[]).map(s => ({
        productId: s.productId, name: s.name, stockIn: Number(s.stockIn || 0), stockOut: Number(s.stockOut || 0), net: Number(s.warehouseQuantity || 0),
      })),
    }),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<WarehouseForm>({ resolver: zodResolver(WarehouseSchema), defaultValues: { isDefault: false } });

  const createMut = useMutation({
    // address must be an object; blank code would collide on the (organizationId, code) unique index.
    mutationFn: (d: WarehouseForm) => api.warehouse.create(dropEmpty({ ...d, name: d.name.trim(), address: d.address?.trim() ? { line1: d.address.trim() } : undefined })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['warehouses'] }); toast.success('Warehouse created'); setShowForm(false); reset(); },
    onError: (e: any) => toast.error(e?.response?.data?.code === 'DUPLICATE_ENTRY' ? 'Another warehouse already uses that code' : apiError(e, 'Could not create the warehouse')),
  });

  const inputCls = "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none";

  return (
    <div className="space-y-6">
      <PageHeader title="Warehouses" subtitle={plural(warehouses.length, 'warehouse')} actions={<Button size="sm" onClick={() => { reset({ isDefault: false }); setShowForm(true); }}><Plus className="w-4 h-4" /> Add Warehouse</Button>} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {isLoading && Array(3).fill(0).map((_, i) => <div key={i} className="h-32 bg-gray-100 dark:bg-gray-700 animate-pulse rounded-xl" />)}
        {warehouses.map((w: any) => (
          <div key={w.id} onClick={() => setSelectedWarehouse(w.id === selectedWarehouse ? null : w.id)} className={`cursor-pointer rounded-xl p-5 border-2 transition ${w.id === selectedWarehouse ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-orange-300'}`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">{w.name}{w.isDefault && <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">Default</span>}</p>
                {w.code && <p className="text-sm text-gray-500 mt-1">{w.code}</p>}
                {addressText(w.address) && <p className="text-xs text-gray-400 mt-1">{addressText(w.address)}</p>}
              </div>
              <Warehouse className="w-8 h-8 text-orange-400" />
            </div>
            {(w.contactPerson || w.phone) && <p className="text-xs text-gray-500 mt-2">Contact: {[w.contactPerson, w.phone].filter(Boolean).join(' · ')}</p>}
          </div>
        ))}
        {!isLoading && !warehouses.length && <div className="md:col-span-3"><EmptyState title="No warehouses" description="Add your storage locations" action={<Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Add Warehouse</Button>} /></div>}
      </div>

      {selectedWarehouse && (
        <Card className="p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Package className="w-4 h-4" /> Stock at {warehouses.find((w: any) => w.id === selectedWarehouse)?.name}</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700">{['Product', 'Stock In', 'Stock Out', 'Net Stock'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-2">{h}</th>)}</tr></thead>
              <tbody>
                {stockLoading && <tr><td colSpan={4}><div className="h-8 bg-gray-100 dark:bg-gray-700 animate-pulse m-2 rounded" /></td></tr>}
                {(stockData?.rows || []).map(s => (
                  <tr key={s.productId} className="border-b border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">{s.name}</td>
                    <td className="px-4 py-2 text-green-600 font-medium">{+s.stockIn.toFixed(3)}</td>
                    <td className="px-4 py-2 text-red-600 font-medium">{+s.stockOut.toFixed(3)}</td>
                    <td className="px-4 py-2 font-semibold">{+s.net.toFixed(3)}</td>
                  </tr>
                ))}
                {!stockLoading && !stockData?.rows?.length && <tr><td colSpan={4} className="text-center py-6 text-gray-500 text-sm">No stock movements for this warehouse</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Add Warehouse</h2>
              <button onClick={() => { setShowForm(false); reset(); }}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleSubmit(d => createMut.mutate(d))} className="p-6 space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Warehouse Name *</label><input {...register('name')} className={inputCls} placeholder="Main Warehouse" />{errors.name && <p className="text-red-500 text-xs mt-1">Enter a name</p>}</div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Code</label><input {...register('code')} className={inputCls} placeholder="WH001" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contact Person</label><input {...register('contactPerson')} className={inputCls} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone</label><input {...register('phone')} className={inputCls} /></div>
              </div>
              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Address</label><textarea {...register('address')} rows={2} className={inputCls} /></div>
              <div className="flex items-center gap-3"><input {...register('isDefault')} type="checkbox" id="isDefault" className="w-4 h-4 rounded text-orange-500" /><label htmlFor="isDefault" className="text-sm text-gray-700 dark:text-gray-300">Set as default warehouse</label></div>
              <div className="flex gap-3 justify-end">
                <Button variant="secondary" type="button" onClick={() => { setShowForm(false); reset(); }}>Cancel</Button>
                <Button type="submit" loading={createMut.isPending}>Create Warehouse</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
