'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { PageHeader, Button, Card, EmptyState, StatusBadge } from '@/components/shared';
import { Plus, Search, X, AlertCircle, ArrowUpDown, TrendingUp, TrendingDown } from 'lucide-react';
import { TabPanel, AnimatedList, AnimatedRow } from '@/components/ui/motion';

const AdjustSchema = z.object({
  productId: z.string().min(1, 'Product required'),
  type: z.enum(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'OPENING_STOCK', 'DAMAGE', 'RETURN_IN', 'RETURN_OUT']),
  quantity: z.coerce.number().min(0.01, 'Quantity required'),
  reason: z.string().optional(),
  warehouseId: z.string().optional(),
});

const TransferSchema = z.object({
  productId: z.string().min(1, 'Required'),
  fromWarehouseId: z.string().min(1, 'Required'),
  toWarehouseId: z.string().min(1, 'Required'),
  quantity: z.coerce.number().min(0.01),
});

export default function InventoryPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'summary' | 'movements' | 'adjust' | 'transfer'>('summary');

  const { data: summary, isLoading: sumLoading } = useQuery({ queryKey: ['inventory-summary'], queryFn: () => api.inventory.getSummary(), select: r => r.data.data });
  const { data: movements, isLoading: movLoading } = useQuery({ queryKey: ['inventory-movements'], queryFn: () => api.inventory.getMovements(), select: r => r.data.data, enabled: tab === 'movements' });
  const { data: products } = useQuery({ queryKey: ['products-simple'], queryFn: () => api.products.list({ limit: 200 }), select: r => r.data.data?.products || [] });
  const { data: warehouses } = useQuery({ queryKey: ['warehouses'], queryFn: () => api.warehouse.list(), select: r => r.data.data?.warehouses || [] });

  const { register: regAdj, handleSubmit: handleAdj, reset: resetAdj, formState: { errors: adjErr } } = useForm<z.infer<typeof AdjustSchema>>({ resolver: zodResolver(AdjustSchema) });
  const { register: regTrans, handleSubmit: handleTrans, reset: resetTrans } = useForm<z.infer<typeof TransferSchema>>({ resolver: zodResolver(TransferSchema) });

  const adjustMut = useMutation({ mutationFn: (d: any) => api.inventory.adjustStock(d), onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-summary'] }); qc.invalidateQueries({ queryKey: ['inventory-movements'] }); toast.success('Stock adjusted'); resetAdj(); } });
  const transferMut = useMutation({ mutationFn: (d: any) => api.inventory.transferStock(d), onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-summary'] }); toast.success('Stock transferred'); resetTrans(); } });

  return (
    <div className="space-y-6">
      <PageHeader title="Inventory Management" subtitle="Track stock levels, movements, and adjustments" />

      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        {[['summary', 'Stock Summary'], ['movements', 'Stock Movements'], ['adjust', 'Adjust Stock'], ['transfer', 'Transfer Stock']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key as any)} className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === key ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{label}</button>
        ))}
      </div>

      <TabPanel tabKey={tab}>
        {tab === 'summary' && (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-gray-200 dark:border-gray-700">
                  {['Product', 'SKU', 'Category', 'In Stock', 'Reorder Level', 'Value', 'Status'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}
                </tr></thead>
                <AnimatedList>
                  {sumLoading && Array(8).fill(0).map((_, i) => <tr key={i}><td colSpan={7}><div className="h-10 bg-gray-100 dark:bg-gray-700 animate-pulse m-3 rounded" /></td></tr>)}
                  {(summary?.products || []).map((p: any) => (
                    <AnimatedRow key={p.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{p.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{p.sku || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{p.category?.name || '-'}</td>
                      <td className="px-4 py-3 font-semibold">{p.currentStock}</td>
                      <td className="px-4 py-3 text-gray-500">{p.reorderLevel}</td>
                      <td className="px-4 py-3 font-semibold">{formatCurrency((p.currentStock || 0) * (p.purchasePrice || 0))}</td>
                      <td className="px-4 py-3">{p.currentStock <= p.reorderLevel ? <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full"><AlertCircle className="w-3 h-3" /> Low Stock</span> : <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">In Stock</span>}</td>
                    </AnimatedRow>
                  ))}
                </AnimatedList>
              </table>
              {!sumLoading && !summary?.products?.length && <EmptyState title="No products" description="Add products to track inventory" />}
            </div>
          </Card>
        )}

        {tab === 'movements' && (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-gray-200 dark:border-gray-700">
                  {['Date', 'Product', 'Type', 'Qty', 'Reference', 'Notes'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}
                </tr></thead>
                <AnimatedList>
                  {movLoading && Array(8).fill(0).map((_, i) => <tr key={i}><td colSpan={6}><div className="h-10 bg-gray-100 dark:bg-gray-700 animate-pulse m-3 rounded" /></td></tr>)}
                  {(movements?.movements || []).map((m: any) => (
                    <AnimatedRow key={m.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3 text-sm text-gray-500">{formatDateTime(m.createdAt)}</td>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{m.product?.name}</td>
                      <td className="px-4 py-3"><StatusBadge status={m.type} /></td>
                      <td className="px-4 py-3">
                        <span className={`font-semibold flex items-center gap-1 ${m.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {m.quantity > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}{Math.abs(m.quantity)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{m.referenceNumber || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{m.notes || '-'}</td>
                    </AnimatedRow>
                  ))}
                </AnimatedList>
              </table>
            </div>
          </Card>
        )}

        {tab === 'adjust' && (
        <Card className="p-6 max-w-lg">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Manual Stock Adjustment</h3>
          <form onSubmit={handleAdj(d => adjustMut.mutate(d))} className="space-y-4">
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Product *</label>
              <select {...regAdj('productId')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none">
                <option value="">Select product</option>
                {(products || []).map((p: any) => <option key={p.id} value={p.id}>{p.name} (Stock: {p.currentStock})</option>)}
              </select>
            </div>
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Adjustment Type</label>
              <select {...regAdj('type')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none">
                {['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGE', 'RETURN_IN', 'RETURN_OUT'].map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quantity *</label><input {...regAdj('quantity')} type="number" step="0.001" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reason</label><textarea {...regAdj('reason')} rows={2} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
            <Button type="submit" loading={adjustMut.isPending}>Adjust Stock</Button>
          </form>
        </Card>
      )}

        {tab === 'transfer' && (
        <Card className="p-6 max-w-lg">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Transfer Stock Between Warehouses</h3>
          <form onSubmit={handleTrans(d => transferMut.mutate(d))} className="space-y-4">
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Product *</label>
              <select {...regTrans('productId')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"><option value="">Select product</option>{(products || []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">From Warehouse</label>
                <select {...regTrans('fromWarehouseId')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"><option value="">Select</option>{(warehouses || []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
              </div>
              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">To Warehouse</label>
                <select {...regTrans('toWarehouseId')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"><option value="">Select</option>{(warehouses || []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
              </div>
            </div>
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quantity</label><input {...regTrans('quantity')} type="number" step="0.001" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
            <Button type="submit" loading={transferMut.isPending}><ArrowUpDown className="w-4 h-4" /> Transfer</Button>
          </form>
        </Card>
        )}
      </TabPanel>
    </div>
  );
}
