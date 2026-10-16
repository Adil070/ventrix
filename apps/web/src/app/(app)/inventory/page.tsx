'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { dropEmpty } from '@/lib/business';
import { PageHeader, Button, Card, EmptyState, StatusBadge } from '@/components/shared';
import { Plus, Search, X, AlertCircle, ArrowUpDown, TrendingUp, TrendingDown } from 'lucide-react';
import { TabPanel, AnimatedList, AnimatedRow } from '@/components/ui/motion';

// Only types the API both validates and can store (RETURN_IN / RETURN_OUT pass validation but crash the insert).
const ADJUST_TYPES = [
  { value: 'ADJUSTMENT_IN', label: 'Add stock (found extra / recount)' },
  { value: 'ADJUSTMENT_OUT', label: 'Remove stock (missing / recount)' },
  { value: 'DAMAGE', label: 'Damaged' },
  { value: 'EXPIRED', label: 'Expired' },
] as const;

const AdjustSchema = z.object({
  productId: z.string().min(1, 'Product required'),
  type: z.enum(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGE', 'EXPIRED']),
  quantity: z.coerce.number().positive('Enter a quantity above 0'),
  notes: z.string().optional(),
  warehouseId: z.string().optional(),
});

const TransferSchema = z.object({
  productId: z.string().min(1, 'Pick an item'),
  fromWarehouseId: z.string().min(1, 'Pick a warehouse'),
  toWarehouseId: z.string().min(1, 'Pick a warehouse'),
  quantity: z.coerce.number().positive('Enter a quantity above 0'),
  notes: z.string().optional(),
}).refine(d => d.fromWarehouseId !== d.toWarehouseId, { path: ['toWarehouseId'], message: 'Pick a different warehouse' });

// Stock entries don't use one sign convention (sales are stored negative, manual adjustments/transfers positive),
// so the direction comes from the movement type.
const OUT_TYPES = new Set(['SALE', 'PURCHASE_RETURN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT', 'PRODUCTION_OUT', 'DAMAGE', 'EXPIRED']);
const MOVEMENT_TEXT: Record<string, string> = {
  PURCHASE: 'Bought', SALE: 'Sold', SALE_RETURN: 'Customer return', PURCHASE_RETURN: 'Returned to supplier',
  ADJUSTMENT_IN: 'Added', ADJUSTMENT_OUT: 'Removed', TRANSFER_IN: 'Transfer in', TRANSFER_OUT: 'Transfer out',
  OPENING_STOCK: 'Opening stock', PRODUCTION_IN: 'Produced', PRODUCTION_OUT: 'Used in production', DAMAGE: 'Damaged', EXPIRED: 'Expired',
};
const SOURCE_TEXT: Record<string, string> = {
  INVOICE: 'Sale bill', PURCHASE: 'Purchase bill', MANUAL_ADJUSTMENT: 'Manual adjustment', WAREHOUSE_TRANSFER: 'Transfer',
  OPENING_STOCK: 'Opening stock', RETURN_ORDER: 'Return',
};
const signedQty = (m: any) => (OUT_TYPES.has(m.movementType) ? -1 : 1) * Math.abs(Number(m.quantity || 0));
const isStockItem = (p: any) => p.trackInventory !== false && p.type !== 'SERVICE';

function apiError(e: any, fallback: string) {
  const d = e?.response?.data;
  const first = (d?.errors || d?.details || [])[0];
  return first?.message ? `${d.message}: ${first.field ? first.field + ' - ' : ''}${first.message}` : d?.message || fallback;
}
const MOV_LIMIT = 50;

export default function InventoryPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'summary' | 'movements' | 'adjust' | 'transfer'>('summary');

  const [movPage, setMovPage] = useState(1);

  // summary -> { products: [...] } with numeric currentStock / reorderLevel / stockValue added by the API.
  const { data: summary, isLoading: sumLoading } = useQuery({ queryKey: ['inventory-summary'], queryFn: () => api.inventory.getSummary(), select: r => r.data.data });
  // movements -> { movements: [...], total, page, totalPages }
  const { data: movements, isLoading: movLoading } = useQuery({ queryKey: ['inventory-movements', movPage], queryFn: () => api.inventory.getMovements({ page: movPage, limit: MOV_LIMIT }), select: r => r.data.data, enabled: tab === 'movements' });
  const { data: products } = useQuery({ queryKey: ['products-simple'], queryFn: () => api.products.list({ limit: 200 }), select: r => r.data.data?.products || [] });
  const { data: warehouses } = useQuery({ queryKey: ['warehouses'], queryFn: () => api.warehouse.list(), select: r => r.data.data?.warehouses || [] });
  const stockItems = (products || []).filter(isStockItem);
  const defaultWarehouseId = (warehouses || []).find((w: any) => w.isDefault)?.id || (warehouses || [])[0]?.id || '';

  const { register: regAdj, handleSubmit: handleAdj, reset: resetAdj, formState: { errors: adjErr } } = useForm<z.infer<typeof AdjustSchema>>({ resolver: zodResolver(AdjustSchema), defaultValues: { type: 'ADJUSTMENT_IN' } });
  const { register: regTrans, handleSubmit: handleTrans, reset: resetTrans, formState: { errors: transErr } } = useForm<z.infer<typeof TransferSchema>>({ resolver: zodResolver(TransferSchema) });

  const refreshStock = () => ['inventory-summary', 'inventory-movements', 'products', 'products-simple', 'warehouse-stock'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
  const adjustMut = useMutation({
    // Without a warehouseId the API books the entry against an arbitrary warehouse, so default to the main one.
    mutationFn: (d: z.infer<typeof AdjustSchema>) => api.inventory.adjustStock(dropEmpty({ ...d, warehouseId: d.warehouseId || defaultWarehouseId })),
    onSuccess: (r: any) => { refreshStock(); toast.success(`Stock updated. Now ${r?.data?.data?.newStock ?? ''} in stock`); resetAdj({ type: 'ADJUSTMENT_IN' }); },
    onError: (e: any) => toast.error(apiError(e, 'Could not adjust stock')),
  });
  const transferMut = useMutation({
    mutationFn: (d: z.infer<typeof TransferSchema>) => api.inventory.transferStock(dropEmpty(d)),
    onSuccess: () => { refreshStock(); toast.success('Stock moved'); resetTrans(); },
    onError: (e: any) => toast.error(apiError(e, 'Could not move stock')),
  });

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
                      <td className="px-4 py-3 font-semibold">{Number(p.currentStock ?? p.openingStock ?? 0)}{p.unit?.abbreviation ? ` ${p.unit.abbreviation}` : ''}</td>
                      <td className="px-4 py-3 text-gray-500">{Number(p.reorderLevel ?? p.reorderPoint ?? 0) || '-'}</td>
                      <td className="px-4 py-3 font-semibold">{formatCurrency(p.stockValue ?? Number(p.openingStock || 0) * Number(p.costPrice || 0))}</td>
                      <td className="px-4 py-3">{(() => {
                        const stock = Number(p.currentStock ?? p.openingStock ?? 0);
                        const reorder = Number(p.reorderLevel ?? p.reorderPoint ?? 0);
                        if (stock <= 0) return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full"><AlertCircle className="w-3 h-3" /> Out of stock</span>;
                        if (reorder > 0 && stock <= reorder) return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full"><AlertCircle className="w-3 h-3" /> Running low</span>;
                        return <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">In stock</span>;
                      })()}</td>
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
                  {['Date', 'Product', 'Type', 'Qty', 'Source', 'Notes'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>)}
                </tr></thead>
                <AnimatedList>
                  {movLoading && Array(8).fill(0).map((_, i) => <tr key={i}><td colSpan={6}><div className="h-10 bg-gray-100 dark:bg-gray-700 animate-pulse m-3 rounded" /></td></tr>)}
                  {(movements?.movements || []).map((m: any) => (
                    <AnimatedRow key={m.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3 text-sm text-gray-500">{formatDateTime(m.createdAt)}</td>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{m.product?.name}</td>
                      <td className="px-4 py-3"><StatusBadge status={m.movementType} label={MOVEMENT_TEXT[m.movementType]} /></td>
                      <td className="px-4 py-3">{(() => {
                        const q = signedQty(m);
                        return <span className={`font-semibold flex items-center gap-1 ${q > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {q > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}{q > 0 ? '+' : '-'}{Math.abs(q)}
                        </span>;
                      })()}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{SOURCE_TEXT[m.referenceType] || m.referenceType || '-'}{m.warehouse?.name ? ` · ${m.warehouse.name}` : ''}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{m.notes || '-'}</td>
                    </AnimatedRow>
                  ))}
                </AnimatedList>
              </table>
              {!movLoading && !movements?.movements?.length && <EmptyState title="No stock movements yet" description="Sales, purchases and adjustments will show up here." />}
            </div>
            {Number(movements?.total || 0) > MOV_LIMIT && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
                <p className="text-sm text-gray-500">Showing {(movPage - 1) * MOV_LIMIT + 1}–{Math.min(movPage * MOV_LIMIT, movements.total)} of {movements.total}</p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" disabled={movPage === 1} onClick={() => setMovPage(p => p - 1)}>Previous</Button>
                  <Button variant="secondary" size="sm" disabled={movPage * MOV_LIMIT >= movements.total} onClick={() => setMovPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </Card>
        )}

        {tab === 'adjust' && (
        <Card className="p-6 max-w-lg">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Manual Stock Adjustment</h3>
          <form onSubmit={handleAdj(d => adjustMut.mutate(d))} className="space-y-4">
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Product *</label>
              <select {...regAdj('productId')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none">
                <option value="">Select product</option>
                {stockItems.map((p: any) => <option key={p.id} value={p.id}>{p.name} (Stock: {Number(p.openingStock || 0)})</option>)}
              </select>
              {adjErr.productId && <p className="text-red-500 text-xs mt-1">{adjErr.productId.message}</p>}
            </div>
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Adjustment Type</label>
              <select {...regAdj('type')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none">
                {ADJUST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {(warehouses || []).length > 1 && <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Warehouse</label>
              <select {...regAdj('warehouseId')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none">
                <option value="">Default warehouse</option>{(warehouses || []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>}
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quantity *</label><input {...regAdj('quantity')} type="number" step="0.001" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" />{adjErr.quantity && <p className="text-red-500 text-xs mt-1">{adjErr.quantity.message}</p>}</div>
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reason</label><textarea {...regAdj('notes')} rows={2} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" /></div>
            <Button type="submit" loading={adjustMut.isPending}>Adjust Stock</Button>
          </form>
        </Card>
      )}

        {tab === 'transfer' && (
        <Card className="p-6 max-w-lg">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Transfer Stock Between Warehouses</h3>
          <form onSubmit={handleTrans(d => transferMut.mutate(d))} className="space-y-4">
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Product *</label>
              <select {...regTrans('productId')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"><option value="">Select product</option>{stockItems.map((p: any) => <option key={p.id} value={p.id}>{p.name} (Stock: {Number(p.openingStock || 0)})</option>)}</select>
              {transErr.productId && <p className="text-red-500 text-xs mt-1">{transErr.productId.message}</p>}
            </div>
            {(warehouses || []).length < 2 && <p className="text-sm text-gray-500">You need at least two warehouses to move stock. Add one on the Warehouses page.</p>}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">From Warehouse</label>
                <select {...regTrans('fromWarehouseId')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"><option value="">Select</option>{(warehouses || []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
                {transErr.fromWarehouseId && <p className="text-red-500 text-xs mt-1">{transErr.fromWarehouseId.message}</p>}
              </div>
              <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">To Warehouse</label>
                <select {...regTrans('toWarehouseId')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"><option value="">Select</option>{(warehouses || []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
                {transErr.toWarehouseId && <p className="text-red-500 text-xs mt-1">{transErr.toWarehouseId.message}</p>}
              </div>
            </div>
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quantity</label><input {...regTrans('quantity')} type="number" step="0.001" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" />{transErr.quantity && <p className="text-red-500 text-xs mt-1">{transErr.quantity.message}</p>}</div>
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Note</label><input {...regTrans('notes')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none" placeholder="Optional" /></div>
            <Button type="submit" loading={transferMut.isPending}><ArrowUpDown className="w-4 h-4" /> Transfer</Button>
          </form>
        </Card>
        )}
      </TabPanel>
    </div>
  );
}
